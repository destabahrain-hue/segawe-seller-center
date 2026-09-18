import { buatXlsxBanyak, G } from './xlsx';
import { laporanKeuangan, detailPeriode } from './keuangan';

/**
 * ── Ekspor Laporan Keuangan ke Excel ──
 *
 * Meniru template yang sudah dipakai, tiga lembar:
 *
 *   LAPORAN PENGHASILAN  rincian per pesanan per SKU
 *   REKAPITULASI         kotak per toko, tiga toko per baris, + blok ALL STORE
 *   SUMMARRY             laba rugi ringkas dengan posisi sel tertentu
 *
 * Susunannya sengaja dipertahankan sampai ke letak kolomnya, supaya
 * berkas yang keluar bisa disandingkan langsung dengan laporan
 * bulan-bulan sebelumnya tanpa menyusun ulang apa pun.
 */

const NAMA_BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

const NAMA_PT = 'PT SEGAWE JAYA MULIA';

function labelPeriode({ dari, sampai, mode }) {
  if (mode === 'bulan') {
    const d = new Date(`${dari}T00:00:00Z`);
    return `${NAMA_BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  return `${dari} S/D ${sampai}`;
}

/** 0/0 harus jadi sel kosong, bukan NaN atau #DIV/0!. */
const bagi = (a, b) => (b ? a / b : null);
const pct = (a, b, bungkus = G.persen) => (b ? bungkus(a / b) : '');

/* ── Lembar 1: LAPORAN PENGHASILAN ───────────────────────────────── */

function lembarPenghasilan(detail, toko) {
  // Iklan ditulis SEKALI per toko, di baris pertama toko itu — persis
  // seperti template. Menulisnya di tiap baris akan membuat orang
  // menjumlahkan kolom itu dan dapat angka berkali-kali lipat.
  const iklanToko = new Map(toko.map((t) => [t.nama, t.iklan]));
  const sudah = new Set();

  const rows = detail.map((d) => {
    let iklan = '';
    if (!sudah.has(d.toko)) {
      sudah.add(d.toko);
      const n = iklanToko.get(d.toko);
      if (n) iklan = G.angka(Math.round(n));
    }
    return [
      d.toko, d.orderSn, d.sku, d.tanggal, d.qty,
      G.angka(d.uang), G.angka(d.hppSatuan), G.angka(d.hppTotal),
      G.angka(d.margin), iklan,
    ];
  });

  return {
    nama: 'LAPORAN PENGHASILAN',
    header: ['Store', 'No. Pesanan', 'SKU', 'Tanggal Order', 'Qty',
             'Uang Masuk (Rp)', 'HPP Satuan (Rp)', 'HPP Total (Rp)',
             'Margin (Rp)', 'Iklan (Include PPN 11%)'],
    lebar: [22, 20, 44, 14, 6, 16, 16, 16, 16, 22],
    rows,
  };
}

/* ── Lembar 2: REKAPITULASI ──────────────────────────────────────── */

const CATATAN_IKLAN =
  'Note : Beban + Bonus. Nilai diatas sudah include PPN 11% dari Beban Iklan';

/**
 * Susunan kotak: tiga toko sejajar per blok, masing-masing tiga kolom
 * (nama, saldo, persen) dengan satu kolom kosong sebagai pemisah.
 * Kolom N ke kanan diisi blok ALL STORE.
 */
function lembarRekap(L, periode) {
  const t = L.total;
  const KOLOM = [1, 5, 9];          // B, F, J — indeks 0-based
  const baris = [];
  const gabung = [];
  const set = (r, c, v) => {
    while (baris.length <= r) baris.push([]);
    const b = baris[r];
    while (b.length <= c) b.push('');
    b[c] = v;
  };

  set(1, 1, G.judulBesar(`PERIODE ${periode}`));

  // Tiap blok toko makan 9 baris; mulai baris ke-3 (indeks 3).
  L.toko.forEach((x, i) => {
    const kol = KOLOM[i % 3];
    const atas = 3 + Math.floor(i / 3) * 9;
    const nama = x.nama + (x.manual ? ' (manual)' : '');

    set(atas,     kol,     G.kepala(nama.toUpperCase()));
    set(atas,     kol + 1, G.kepala('SALDO'));
    set(atas,     kol + 2, G.kepala('%'));
    set(atas + 1, kol,     G.kotak('Penjualan Bersih'));
    set(atas + 1, kol + 1, G.rp(x.penjualan));
    set(atas + 1, kol + 2, G.kotak(''));
    set(atas + 2, kol,     G.kotak('Hpp'));
    set(atas + 2, kol + 1, G.rp(x.hpp));
    set(atas + 2, kol + 2, G.kotak(''));

    // Hijau muda — sama seperti baris Margin di template.
    set(atas + 3, kol,     G.margin('Margin'));
    set(atas + 3, kol + 1, G.marginRp(x.margin));
    set(atas + 3, kol + 2, pct(x.margin, x.penjualan, G.marginPct) || G.margin(''));

    // Oranye — baris Total Iklan.
    set(atas + 5, kol,     G.iklan('Total Iklan'));
    set(atas + 5, kol + 1, G.iklanRp(x.iklan));
    set(atas + 5, kol + 2, pct(x.iklan, x.penjualan, G.iklanPct) || G.iklan(''));

    set(atas + 6, kol, G.catatan(CATATAN_IKLAN));

    // Hijau tua — baris Gross Profit.
    set(atas + 7, kol,     G.gross('Gross Profit'));
    set(atas + 7, kol + 1, G.grossRp(x.grossProfit));
    set(atas + 7, kol + 2, pct(x.grossProfit, x.penjualan, G.grossPct) || G.gross(''));
  });

  // Blok ALL STORE di kolom N/O/P (indeks 13/14/15).
  const K = 13;
  set(4,  K,     G.ungu('REKAPITULASI PENGHASILAN ALL STORE'));
  set(4,  K + 1, G.ungu(''));
  set(4,  K + 2, G.ungu(''));
  gabung.push('N5:P5');

  set(6,  K,     G.kepala('PENDAPATAN'));
  set(6,  K + 1, G.kepala('SALDO'));
  set(6,  K + 2, G.kepala('%'));
  set(8,  K,     G.kotak('Total Penjualan'));
  set(8,  K + 1, G.rp(t.penjualan));
  set(8,  K + 2, G.kotak(''));
  set(9,  K,     G.kotak('Total Hpp'));
  set(9,  K + 1, G.rp(t.hpp));
  set(9,  K + 2, G.kotak(''));
  set(10, K,     G.gross('GROSS PROFIT'));
  set(10, K + 1, G.grossRp(t.grossProfit));
  set(10, K + 2, pct(t.grossProfit, t.penjualan, G.grossPct) || G.gross(''));

  set(13, K,     G.kepala('BEBAN'));
  set(13, K + 1, G.kepala(''));
  set(13, K + 2, G.kepala(''));
  set(15, K,     G.iklan('Potongan Iklan'));
  set(15, K + 1, G.iklanRp(t.iklan));
  set(15, K + 2, pct(t.iklan, t.penjualan, G.iklanPct) || G.iklan(''));

  let r = 16;
  for (const b of L.beban) {
    set(r, K,     G.kotak(b.jenis));
    set(r, K + 1, G.rp(b.nominal));
    set(r, K + 2, pct(b.nominal, t.penjualan, G.persen) || G.kotak(''));
    r++;
  }
  r++;
  set(r, K,     G.gross('NETT PROFIT'));
  set(r, K + 1, G.grossRp(t.nett));
  set(r, K + 2, pct(t.nett, t.penjualan, G.grossPct) || G.gross(''));

  return {
    nama: 'REKAPITULASI',
    header: [],
    lebar: [3, 32, 20, 9, 3, 32, 20, 9, 3, 32, 20, 9, 3, 30, 20, 9],
    gabung,
    rows: baris,
  };
}

/* ── Lembar 3: SUMMARRY ──────────────────────────────────────────── */

function lembarSummarry(L, periode) {
  const t = L.total;
  const baris = [];
  const set = (r, c, v) => {
    while (baris.length <= r) baris.push([]);
    const b = baris[r];
    while (b.length <= c) b.push('');
    b[c] = v;
  };

  set(2, 2, G.judul(NAMA_PT));
  set(3, 2, G.judul(`LAPORAN PENGHASILAN ALL SOURCE PERIODE ${periode}`));
  // Judul dibentang selebar area laporan, seperti template.
  const gabung = ['C3:H3', 'C4:H5'];

  set(7, 2, G.garisBawah('KETERANGAN'));
  set(7, 7, G.garisBawah('SALDO'));

  set(9,  2, G.tebal('TOTAL PENDAPATAN'));
  set(11, 3, 'Penjualan');
  set(11, 7, G.rp(t.penjualan));
  set(12, 3, 'Harga Pokok Penjualan');
  set(12, 7, G.rp(t.hpp));

  set(14, 2, G.tebal('PENGELUARAN'));
  let r = 16;
  for (const b of L.beban) {
    set(r, 3, b.jenis);
    set(r, 7, G.rp(b.nominal));
    r++;
  }

  r += 1;
  set(r, 2, G.tebal('PENYESUAIAN'));
  r += 2;
  set(r, 3, 'Potongan Iklan');
  set(r, 7, G.rp(t.iklan));
  set(r + 1, 6, G.catatan('Include PPN 11%'));

  r += 2;
  set(r, 2, G.tebal('JUMLAH KEWAJIBAN'));
  set(r, 7, G.grossRp(t.nett));
  set(r + 1, 3, G.tebal('NETT'));
  set(r + 1, 7, pct(t.nett, t.penjualan));

  /**
   * Peringatan ikut ditulis ke dalam berkas, bukan cuma di layar.
   * Berkas ini beredar lewat WhatsApp dan email; orang yang membukanya
   * belum tentu pernah melihat halaman aplikasinya.
   */
  r += 4;
  if (L.opexKosong) {
    set(r, 2, G.tebal('PERINGATAN: beban operasional periode ini belum diisi — NETT di atas masih laba sebelum opex.'));
    r += 1;
  }
  if (t.barisTanpaHpp > 0) {
    set(r, 2, G.tebal(`PERINGATAN: ${t.barisTanpaHpp} baris pesanan tidak punya HPP, jadi laba di atas terlalu besar.`));
    r += 1;
  }
  set(r + 1, 2, 'Penjualan = uang yang benar-benar diterima, sudah bersih seluruh potongan marketplace.');
  set(r + 2, 2, 'Periode memakai tanggal dana dilepas, bukan tanggal pesanan. Pesanan yang belum cair belum masuk.');
  set(r + 3, 2, 'Biaya iklan = (beban x 1,11) dikurangi bonus saldo dan bonus proteksi ROAS.');

  return {
    nama: 'SUMMARRY',
    header: [],
    lebar: [3, 3, 34, 30, 3, 3, 18, 22],
    gabung,
    rows: baris,
  };
}

/* ── Perakit ─────────────────────────────────────────────────────── */

export async function eksporKeuangan({ dari, sampai, mode = 'bulan' }) {
  const [L, detail] = await Promise.all([
    laporanKeuangan({ dari, sampai, mode }),
    detailPeriode(dari, sampai),
  ]);
  const periode = labelPeriode({ dari, sampai, mode });

  return buatXlsxBanyak([
    lembarPenghasilan(detail, L.toko),
    lembarRekap(L, periode),
    lembarSummarry(L, periode),
  ]);
}

/** Nama berkas mengikuti pola yang sudah dipakai. */
export function namaBerkas({ dari, sampai, mode = 'bulan' }) {
  if (mode === 'bulan') {
    const d = new Date(`${dari}T00:00:00Z`);
    return `LAPORAN_KEUANGAN_PERIODE_${NAMA_BULAN[d.getUTCMonth()]}_${d.getUTCFullYear()}.xlsx`;
  }
  return `LAPORAN_KEUANGAN_${dari}_sd_${sampai}.xlsx`;
}
