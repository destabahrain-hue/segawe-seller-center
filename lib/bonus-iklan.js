import { q } from './db';

/**
 * ── Bonus iklan Shopee ──
 *
 * Sumbernya ekspor CSV dari Shopee Ads > Riwayat Transaksi. Satu berkas
 * per jenis bonus, dan berkasnya sendiri menyebutkan ID Toko serta
 * rentang tanggalnya — jadi tidak ada yang perlu diketik.
 *
 * Bentuk berkasnya:
 *
 *     Riwayat Transaksi
 *     Mata uang:,IDR
 *     Username:,humaira.indoshop
 *     Tanggal:,01/08/2026 -- 31/08/2026
 *     ID Toko:,64712993
 *     (baris kosong)
 *     Urutan,Waktu,Deskripsi,Jumlah,Catatan
 *     1,21/08/2026,Bonus Saldo Iklan,2322771,...
 *
 * PERLAKUAN PPN: bonus dikurangkan SESUDAH PPN — (beban x 1,11) - bonus.
 * Rebate tidak dikenai PPN. Jangan tertukar dengan (beban - bonus) x
 * 1,11; selisihnya 11% dari nilai bonusnya.
 */

/** Jenis bonus dikenali dari kolom Deskripsi. */
function jenisDari(deskripsi) {
  const d = String(deskripsi || '').toLowerCase();
  if (d.includes('roas')) return 'roas';
  if (d.includes('bonus saldo') || d.includes('credit')) return 'saldo';
  return null;
}

export const LABEL_JENIS = { saldo: 'Bonus Saldo Iklan', roas: 'Proteksi ROAS' };

/** '21/08/2026' → '2026-08-21'. */
function tanggal(x) {
  const m = String(x || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function angka(x) {
  const n = Number(String(x ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pembelah baris CSV yang menghormati tanda kutip.
 *
 * Kolom Catatan memuat teks bebas seperti
 * "Bonus Saldo Iklan: {credit} (Applicable Ad Type: All Ads)" yang bisa
 * mengandung koma. Membelah dengan split(',') polos akan menggeser
 * seluruh kolom dan nominalnya terbaca salah tanpa ada galat apa pun.
 */
function belah(baris) {
  const out = [];
  let kini = '', dalamKutip = false;
  for (let i = 0; i < baris.length; i++) {
    const c = baris[i];
    if (c === '"') {
      if (dalamKutip && baris[i + 1] === '"') { kini += '"'; i++; }
      else dalamKutip = !dalamKutip;
    } else if (c === ',' && !dalamKutip) { out.push(kini); kini = ''; }
    else kini += c;
  }
  out.push(kini);
  return out.map((x) => x.trim());
}

/**
 * Baca satu berkas. Melempar galat kalau bentuknya bukan yang
 * diharapkan — laporan bernilai nol karena salah berkas jauh lebih
 * berbahaya daripada pesan galat.
 */
export function bacaBonus(teks) {
  // BOM di awal berkas Shopee membuat pencocokan baris pertama gagal.
  const baris = String(teks).replace(/^\uFEFF/, '').split(/\r?\n/);

  let shopId = null, periode = null, mulaiTabel = -1;
  for (let i = 0; i < baris.length; i++) {
    const k = belah(baris[i]);
    const kepala = (k[0] || '').toLowerCase();
    if (kepala.startsWith('id toko')) shopId = String(k[1] || '').trim();
    if (kepala.startsWith('tanggal')) {
      const m = String(k[1] || '').match(/(\d{2}\/\d{2}\/\d{4})\s*--\s*(\d{2}\/\d{2}\/\d{4})/);
      if (m) periode = { dari: tanggal(m[1]), sampai: tanggal(m[2]) };
    }
    if (kepala === 'urutan') { mulaiTabel = i + 1; break; }
  }

  if (!shopId) throw new Error('Baris "ID Toko" tidak ditemukan — pastikan ini ekspor Riwayat Transaksi Shopee Ads.');
  if (mulaiTabel < 0) throw new Error('Baris judul tabel (Urutan, Waktu, Deskripsi, Jumlah) tidak ditemukan.');
  if (!periode) throw new Error('Rentang tanggal di baris "Tanggal:" tidak terbaca.');

  const isi = [];
  const perJenis = new Map();
  for (let i = mulaiTabel; i < baris.length; i++) {
    if (!baris[i].trim()) continue;
    const k = belah(baris[i]);
    const tgl = tanggal(k[1]);
    if (!tgl) continue;                       // baris keterangan di bawah tabel
    const jenis = jenisDari(k[2]);
    if (!jenis) continue;
    const nominal = Math.abs(angka(k[3]));
    if (!nominal) continue;
    isi.push({ tanggal: tgl, jenis, nominal, deskripsi: k[2] || null, catatan: k[4] || null });
    perJenis.set(jenis, (perJenis.get(jenis) || 0) + nominal);
  }

  if (!isi.length) throw new Error('Tidak ada baris bonus yang terbaca di berkas ini.');

  return {
    shopId, periode, isi,
    total: isi.reduce((a, x) => a + x.nominal, 0),
    perJenis: [...perJenis].map(([jenis, nominal]) => ({ jenis, nominal })),
  };
}

/**
 * Simpan, menggantikan isi lama.
 *
 * Seluruh baris toko + jenis di dalam rentang berkas DIHAPUS lebih dulu,
 * baru dimasukkan ulang. Dengan begitu mengunggah berkas yang sama dua
 * kali tidak melipatgandakan bonusnya — dan itu pasti terjadi cepat
 * atau lambat.
 *
 * Hanya jenis yang ADA di berkas yang dihapus, supaya mengunggah berkas
 * proteksi ROAS tidak menghapus bonus saldo yang sudah masuk lebih dulu.
 */
export async function ganti(hasil) {
  const jenis = [...new Set(hasil.isi.map((x) => x.jenis))];
  await q(
    `DELETE FROM bonus_iklan
      WHERE shop_id = $1 AND jenis = ANY($2::text[])
        AND tanggal >= $3::date AND tanggal <= $4::date`,
    [hasil.shopId, jenis, hasil.periode.dari, hasil.periode.sampai]);

  for (const b of hasil.isi) {
    await q(
      `INSERT INTO bonus_iklan (shop_id, tanggal, jenis, nominal, deskripsi, catatan)
       VALUES ($1,$2::date,$3,$4,$5,$6)`,
      [hasil.shopId, b.tanggal, b.jenis, b.nominal, b.deskripsi, b.catatan]);
  }
  return hasil.isi.length;
}

/**
 * Total bonus per toko untuk rentang tanggal bebas.
 *
 * Karena tersimpan per hari, ini angka NYATA untuk rentang apa pun —
 * termasuk minggu yang memotong dua bulan. Tidak ada pembagian rata.
 */
export async function bonusPeriode(dari, sampai) {
  const rows = await q(
    `SELECT shop_id, SUM(nominal) AS total
       FROM bonus_iklan
      WHERE tanggal >= $1::date AND tanggal < $2::date
      GROUP BY shop_id`, [dari, sampai]);
  return new Map(rows.map((r) => [String(r.shop_id), Number(r.total) || 0]));
}

/** Rincian untuk ditampilkan di halaman Beban Operasional. */
export async function daftarBonus(dari, sampai) {
  return q(
    `SELECT b.shop_id, s.shop_name, b.jenis,
            COUNT(*)::int   AS baris,
            SUM(b.nominal)  AS total,
            MIN(b.tanggal)  AS terawal,
            MAX(b.tanggal)  AS terakhir
       FROM bonus_iklan b
       LEFT JOIN shops s ON s.shop_id = b.shop_id
      WHERE b.tanggal >= $1::date AND b.tanggal < $2::date
      GROUP BY b.shop_id, s.shop_name, b.jenis
      ORDER BY s.shop_name NULLS LAST, b.jenis`, [dari, sampai]);
}

export async function hapusBonusPeriode(shopId, jenis, dari, sampai) {
  await q(
    `DELETE FROM bonus_iklan
      WHERE shop_id = $1 AND jenis = $2
        AND tanggal >= $3::date AND tanggal < $4::date`,
    [shopId, jenis, dari, sampai]);
}
