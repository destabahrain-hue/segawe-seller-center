import * as XLSX from 'xlsx';

/**
 * ── Pembaca berkas TikTok ──
 *
 * Dua berkas dari TikTok Seller Center:
 *
 *   income_*.xlsx          → uang yang diterima per pesanan + biaya iklan
 *   Selesai_pesanan_*.xlsx → SKU apa saja di tiap pesanan
 *
 * Disambung lewat Order ID. Dari situ HPP dihitung dari Master SKU,
 * bukan diketik tangan.
 *
 * TIGA HAL YANG MAHAL DIPELAJARI, JANGAN DIUBAH TANPA MENGUKUR ULANG
 *
 * 1. Biaya iklan dibaca dari sheet "Detail pesanan", BUKAN sheet
 *    "Laporan". Keduanya bisa berbeda: Agustus 2026 memberi 37.740.000
 *    di Detail pesanan dan 36.075.000 di Laporan. Yang cocok dengan
 *    pembukuan adalah yang pertama — 37.740.000 x 1,11 = 41.891.400,
 *    persis angka Total Iklan di laporan Excel.
 *
 * 2. Penjualan = jumlah baris bertipe "Pesanan" saja. Biaya iklan
 *    tercatat sebagai baris transaksi TERPISAH, tidak dipotong di dalam
 *    nilai per pesanan, jadi TIDAK boleh ditambahkan kembali.
 *
 * 3. Penyaringnya Order ID dari berkas income, BUKAN tanggal. Berkas
 *    income Agustus memuat pesanan yang dibuat Juni dan Juli senilai
 *    Rp 70 juta — hampir 30% penjualan bulan itu. Menyaring dengan
 *    tanggal akan membuang semuanya beserta HPP-nya.
 */

const SHEET_INCOME  = 'Detail pesanan';
const SHEET_LAPORAN = 'Laporan';
const SHEET_PESANAN = 'OrderSKUList';

const TIPE_PESANAN = 'Pesanan';
const TIPE_IKLAN = [
  'Pembayaran GMV untuk Iklan TikTok',
  'Biaya iklan GMV Max',
  'Voucher GMV Max',
  'Pajak penjualan atas voucher GMV Max',
];

/** PPN iklan, mengikuti perlakuan yang sama dengan toko Shopee. */
export const PPN_IKLAN_TIKTOK = 0.11;

/**
 * Angka TikTok datang sebagai teks. Dipisah sendiri supaya format yang
 * tak terduga tidak diam-diam jadi NaN lalu dibaca nol — laporan
 * bernilai nol yang terlihat wajar jauh lebih berbahaya daripada galat.
 */
function angka(x) {
  if (x === null || x === undefined || x === '') return 0;
  if (typeof x === 'number') return x;
  const t = String(x).trim().replace(/\s/g, '');
  const bersih = t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')
    ? t.replace(/\./g, '').replace(',', '.')
    : t.replace(/,/g, '');
  const n = Number(bersih);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Hitung ulang rentang sheet dari sel yang benar-benar ada.
 *
 * WAJIB. Ekspor TikTok menuliskan dimensi sheet yang SALAH: berkas
 * income Agustus 2026 menyatakan rentangnya A1:CD19 padahal isinya
 * 1.483 baris. Kalau dimensi itu dipercaya, pembacaan berhenti di baris
 * ke-19 dan laporan keluar dengan Rp 3 juta alih-alih Rp 247 juta —
 * angka yang terlihat wajar di layar dan tidak akan dicurigai siapa pun.
 */
function perbaikiRef(ws) {
  let maxR = 0, maxC = 0;
  for (const kunci of Object.keys(ws)) {
    if (kunci[0] === '!') continue;
    const m = kunci.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    let kol = 0;
    for (const ch of m[1]) kol = kol * 26 + (ch.charCodeAt(0) - 64);
    if (kol - 1 > maxC) maxC = kol - 1;
    const bar = Number(m[2]) - 1;
    if (bar > maxR) maxR = bar;
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}

function bukaSheet(buffer, nama, pesanGagal) {
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer' }); }
  catch { throw new Error('Berkas tidak bisa dibuka. Pastikan ini .xlsx dari TikTok Seller Center.'); }
  const ws = wb.Sheets[nama];
  if (!ws) throw new Error(pesanGagal);
  return { wb, baris: XLSX.utils.sheet_to_json(perbaikiRef(ws), { header: 1, raw: false, defval: '' }) };
}

/** Peta nama kolom → indeks, dibaca dari baris header. */
function petaKolom(header) {
  const p = {};
  header.forEach((h, i) => { const k = String(h ?? '').trim(); if (k && !(k in p)) p[k] = i; });
  return p;
}

/** '2026/08/01-2026/08/31' → { dari, sampai } dengan sampai eksklusif. */
function bacaPeriode(teks) {
  const m = String(teks || '').match(/(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const a = new Date(`${m[4]}-${m[5]}-${m[6]}T00:00:00Z`);
  a.setUTCDate(a.getUTCDate() + 1);
  return { dari: `${m[1]}-${m[2]}-${m[3]}`, sampai: a.toISOString().slice(0, 10) };
}

/** '2026/08/24' atau '24/08/2026' → '2026-08-24'. */
function tanggal(x) {
  const t = String(x ?? '').trim();
  let m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Berkas income: nilai per pesanan + biaya iklan + periode. */
export function bacaIncome(buffer) {
  const { wb, baris } = bukaSheet(buffer, SHEET_INCOME,
    `Sheet "${SHEET_INCOME}" tidak ada. Yang dibutuhkan berkas income_*.xlsx.`);

  const k = petaKolom(baris[0] || []);
  const cId    = k['ID Pesanan/Penyesuaian'];
  const cTipe  = k['Jenis transaksi'];
  const cWaktu = k['Waktu pemesanan'];
  const cNilai = k['Jumlah penyelesaian pembayaran'];
  if ([cId, cTipe, cNilai].some((x) => x === undefined)) {
    throw new Error(`Kolom wajib tidak ditemukan di sheet "${SHEET_INCOME}".`);
  }

  const pesanan = new Map();          // orderId → { nilai, tgl }
  const rincianIklan = new Map();
  let iklanPokok = 0;

  for (let i = 1; i < baris.length; i++) {
    const r = baris[i];
    const id = String(r[cId] ?? '').trim();
    if (!id) continue;
    const tipe = String(r[cTipe] ?? '').trim();
    const nilai = angka(r[cNilai]);

    if (tipe === TIPE_PESANAN) {
      const lama = pesanan.get(id);
      pesanan.set(id, {
        nilai: (lama?.nilai || 0) + nilai,
        tgl: lama?.tgl || tanggal(r[cWaktu]),
      });
    } else if (TIPE_IKLAN.includes(tipe)) {
      const n = Math.abs(nilai);
      iklanPokok += n;
      rincianIklan.set(tipe, (rincianIklan.get(tipe) || 0) + n);
    }
  }

  // Periode diambil dari sheet Laporan — satu-satunya tempat TikTok
  // menyebutkan rentangnya secara tertulis.
  let periodeTeks = null;
  const wsLap = wb.Sheets[SHEET_LAPORAN];
  if (wsLap) {
    const bl = XLSX.utils.sheet_to_json(perbaikiRef(wsLap), { header: 1, raw: false, defval: '' });
    for (const r of bl) {
      const i = r.findIndex((c) => String(c ?? '').trim() === 'Periode');
      if (i >= 0) { periodeTeks = r.slice(i + 1).find((c) => String(c ?? '').trim()); break; }
    }
  }

  const penjualan = [...pesanan.values()].reduce((a, x) => a + x.nilai, 0);
  const ppn = iklanPokok * PPN_IKLAN_TIKTOK;

  return {
    periodeTeks: periodeTeks || null,
    periode: bacaPeriode(periodeTeks),
    pesanan,
    jumlahPesanan: pesanan.size,
    penjualan,
    iklanPokok, ppn, iklan: iklanPokok + ppn,
    rincianIklan: [...rincianIklan].map(([label, nominal]) => ({ label, nominal })),
  };
}

/** Berkas pesanan: rincian SKU per Order ID. */
export function bacaPesanan(buffer) {
  const { baris } = bukaSheet(buffer, SHEET_PESANAN,
    `Sheet "${SHEET_PESANAN}" tidak ada. Yang dibutuhkan berkas daftar pesanan (Selesai_pesanan_*.xlsx).`);

  const k = petaKolom(baris[0] || []);
  const cId  = k['Order ID'];
  const cSku = k['Seller SKU'];
  const cQty = k['Quantity'];
  const cRet = k['Sku Quantity of return'];
  if ([cId, cSku, cQty].some((x) => x === undefined)) {
    throw new Error(`Kolom wajib tidak ditemukan di sheet "${SHEET_PESANAN}".`);
  }

  const per = new Map();
  for (let i = 1; i < baris.length; i++) {
    const r = baris[i];
    const id = String(r[cId] ?? '').trim();
    const sku = String(r[cSku] ?? '').trim();
    // Baris keterangan di bawah tabel ikut terbaca — disaring lewat
    // kewajaran isinya, bukan lewat nomor baris, karena jumlah baris
    // keterangan berubah-ubah antar ekspor.
    if (!id || !sku || !/^\d{6,}$/.test(id)) continue;

    const qty = angka(r[cQty]);
    const retur = cRet === undefined ? 0 : angka(r[cRet]);
    // HPP hanya dibebankan pada barang yang TIDAK kembali — barang yang
    // diretur masuk gudang lagi, modalnya belum terpakai.
    const qtyKena = Math.max(qty - retur, 0);

    if (!per.has(id)) per.set(id, []);
    per.get(id).push({ sku, qty: qtyKena });
  }
  return per;
}

/**
 * Sambungkan keduanya.
 *
 * Cakupan diukur dari RUPIAH, bukan jumlah pesanan. Pesanan yang tidak
 * ketemu umumnya bernilai Rp 0 — batal atau retur penuh — dan memang
 * tidak boleh dibebani HPP. Mengukur dari jumlah pesanan memberi kesan
 * ada 29% data hilang padahal tidak ada satu rupiah pun yang hilang.
 */
export function gabung(income, perPesanan) {
  const peta = new Map();
  let nilaiKetemu = 0, nilaiHilang = 0, pesananKetemu = 0;
  const hilangBernilai = [];

  for (const [id, { nilai, tgl }] of income.pesanan) {
    const isi = perPesanan.get(id);
    if (!isi || isi.length === 0) {
      nilaiHilang += nilai;
      // Hanya yang BERNILAI patut dilaporkan; yang nol memang tidak
      // seharusnya ada di ekspor pesanan berstatus Selesai.
      if (nilai > 0) hilangBernilai.push({ id, nilai, tgl });
      continue;
    }
    pesananKetemu++;
    nilaiKetemu += nilai;
    for (const b of isi) {
      if (b.qty <= 0) continue;
      // Digabung per (sku, tanggal) supaya kueri HPP tidak mengirim
      // ribuan baris yang sebagian besar kembar.
      const kunci = `${b.sku}\u0000${tgl || ''}`;
      peta.set(kunci, (peta.get(kunci) || 0) + b.qty);
    }
  }

  const butir = [...peta].map(([kunci, qty]) => {
    const [sku, tgl] = kunci.split('\u0000');
    return { sku, tgl: tgl || null, qty };
  });

  return {
    butir,
    pesananKetemu,
    pesananTotal: income.jumlahPesanan,
    nilaiKetemu, nilaiHilang,
    hilangBernilai: hilangBernilai.sort((a, b) => b.nilai - a.nilai).slice(0, 20),
    cakupanNilai: income.penjualan ? (nilaiKetemu / income.penjualan) * 100 : 0,
  };
}

export function bulanDariPeriode(periode) {
  if (!periode?.dari) return null;
  return periode.dari.slice(0, 8) + '01';
}
