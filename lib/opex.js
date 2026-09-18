import { q } from './db';

/**
 * Beban operasional tingkat grup + toko yang diinput manual.
 *
 * Kenapa terpisah dari lib/report.js: report.js seluruhnya berasal dari
 * data Shopee yang ditarik API dan tidak pernah diketik orang. Yang di
 * sini kebalikannya — semuanya diketik tangan. Mencampurnya membuat
 * sulit menjawab "angka ini dari mana", yang selama ini justru jadi
 * sumber kebingungan berulang.
 */

/**
 * Jenis bawaan — nama dan URUTANNYA disamakan persis dengan sheet
 * SUMMARRY di laporan Excel Prima.
 *
 * Nama harus sama supaya baris Excel dan baris aplikasi bisa
 * dibandingkan satu-satu tanpa tabel terjemahan. Urutannya juga
 * dipakai apa adanya untuk menyusun baris BEBAN di Laporan Keuangan,
 * jadi mengubah urutan di sini ikut mengubah tampilan laporan.
 */
export const JENIS_OPEX = [
  'Beban Gaji',
  'Cicilan Mudharabah BSI',
  'Beban Listrik',
  'Beban Sewa',
  'Beban Wifi',
  'Biaya Operasional Gudang',
  'Incidental Expenses',
];

/** Urutan tampil: yang dikenal ikut JENIS_OPEX, jenis bebas menyusul. */
export function urutkanJenis(baris) {
  const pos = new Map(JENIS_OPEX.map((j, i) => [j, i]));
  return [...baris].sort((a, b) =>
    (pos.get(a.jenis) ?? 999) - (pos.get(b.jenis) ?? 999)
    || String(a.jenis).localeCompare(String(b.jenis)));
}

/**
 * Paksa tanggal apa pun jadi tanggal 1 bulan itu.
 *
 * Tanpa ini, "September" yang diinput tanggal 3 dan tanggal 17 akan jadi
 * dua baris berbeda dan batasan UNIQUE (bulan, jenis) tidak ada gunanya.
 * Dilakukan di sini, bukan di database, supaya kesalahannya ketahuan
 * lebih awal.
 */
export function awalBulan(x) {
  const d = x instanceof Date ? x : new Date(x);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Semua baris opex satu bulan, beserta totalnya. */
export async function opexBulan(bulan) {
  const b = awalBulan(bulan);
  if (!b) return { bulan: null, baris: [], total: 0 };
  const mentah = await q(
    `SELECT id, jenis, nominal, catatan
       FROM opex WHERE bulan = $1::date`, [b]);
  const baris = urutkanJenis(mentah);
  const total = baris.reduce((a, r) => a + Number(r.nominal || 0), 0);
  return { bulan: b, baris, total };
}

/**
 * Total opex untuk rentang tanggal bebas, dibagi rata per hari.
 *
 * Laporan mingguan butuh ini: opex dicatat bulanan, sedangkan minggu
 * bisa memotong dua bulan sekaligus. Pembagiannya per hari kalender,
 * BUKAN per hari kerja — gaji dan cicilan tetap jalan di hari libur.
 *
 * Hasilnya taksiran, bukan angka nyata, dan halaman yang memakainya
 * WAJIB menyebut itu. Opex bulanan yang sesungguhnya cuma ada di
 * laporan bulanan.
 */
export async function opexProrata(dari, sampai) {
  const a = new Date(dari);
  const z = new Date(sampai);
  if (Number.isNaN(a.getTime()) || Number.isNaN(z.getTime())) return 0;

  const rows = await q(
    `SELECT bulan, SUM(nominal) AS total
       FROM opex
      WHERE bulan >= date_trunc('month', $1::timestamptz)
        AND bulan <= date_trunc('month', $2::timestamptz)
      GROUP BY bulan`, [dari, sampai]);

  let jumlah = 0;
  for (const r of rows) {
    const awal = new Date(r.bulan);
    const akhirBulan = new Date(Date.UTC(
      awal.getUTCFullYear(), awal.getUTCMonth() + 1, 0));
    const hariSebulan = akhirBulan.getUTCDate();

    // Irisan antara bulan ini dan rentang yang diminta.
    const mulai = awal > a ? awal : a;
    const henti = akhirBulan < z ? akhirBulan : z;
    const hariIris = Math.floor((henti - mulai) / 86400000) + 1;
    if (hariIris <= 0) continue;

    jumlah += Number(r.total || 0) * (hariIris / hariSebulan);
  }
  return jumlah;
}

/** Toko manual (TikTok) untuk satu bulan. */
export async function tokoManualBulan(bulan) {
  const b = awalBulan(bulan);
  if (!b) return [];
  return q(
    `SELECT id, nama, penjualan, hpp, iklan, catatan
       FROM toko_manual WHERE bulan = $1::date
      ORDER BY nama`, [b]);
}

/** Simpan satu baris opex. Jenis yang sama di bulan sama akan ditimpa. */
export async function simpanOpex({ bulan, jenis, nominal, catatan }) {
  const b = awalBulan(bulan);
  if (!b) throw new Error('Bulan tidak sah');
  if (!jenis || !String(jenis).trim()) throw new Error('Jenis belum diisi');
  await q(
    `INSERT INTO opex (bulan, jenis, nominal, catatan)
     VALUES ($1::date, $2, $3, $4)
     ON CONFLICT (bulan, jenis) DO UPDATE SET
       nominal    = EXCLUDED.nominal,
       catatan    = EXCLUDED.catatan,
       updated_at = now()`,
    [b, String(jenis).trim(), Number(nominal) || 0, catatan || null]);
}

/** Simpan satu baris toko manual. */
export async function simpanTokoManual({ bulan, nama, penjualan, hpp, iklan, catatan }) {
  const b = awalBulan(bulan);
  if (!b) throw new Error('Bulan tidak sah');
  if (!nama || !String(nama).trim()) throw new Error('Nama toko belum diisi');
  await q(
    `INSERT INTO toko_manual (bulan, nama, penjualan, hpp, iklan, catatan)
     VALUES ($1::date, $2, $3, $4, $5, $6)
     ON CONFLICT (bulan, nama) DO UPDATE SET
       penjualan  = EXCLUDED.penjualan,
       hpp        = EXCLUDED.hpp,
       iklan      = EXCLUDED.iklan,
       catatan    = EXCLUDED.catatan,
       updated_at = now()`,
    [b, String(nama).trim(), Number(penjualan) || 0, Number(hpp) || 0,
     Number(iklan) || 0, catatan || null]);
}

export async function hapusOpex(id) {
  await q('DELETE FROM opex WHERE id = $1', [id]);
}

export async function hapusTokoManual(id) {
  await q('DELETE FROM toko_manual WHERE id = $1', [id]);
}

/**
 * Salin seluruh opex bulan sebelumnya ke bulan yang diminta.
 *
 * Opex Prima hampir sama tiap bulan — gaji, cicilan, listrik, wifi,
 * gudang. Tanpa tombol ini, tiap awal bulan harus mengetik ulang lima
 * baris yang sama, dan yang terjadi biasanya bukan salah ketik
 * melainkan lupa mengisi sama sekali.
 *
 * Baris yang SUDAH ada di bulan tujuan tidak ditimpa — kalau bulan ini
 * gajinya sudah disesuaikan, penyesuaian itu yang menang.
 */
export async function salinBulanLalu(bulan) {
  const b = awalBulan(bulan);
  if (!b) throw new Error('Bulan tidak sah');
  const r = await q(
    `INSERT INTO opex (bulan, jenis, nominal, catatan)
     SELECT $1::date, jenis, nominal, catatan
       FROM opex
      WHERE bulan = ($1::date - interval '1 month')::date
     ON CONFLICT (bulan, jenis) DO NOTHING
     RETURNING id`, [b]);
  return r.length;
}
