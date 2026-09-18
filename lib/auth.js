import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { q, one } from './db';

/**
 * ── Peran dan hak akses ──
 *
 * Dua lapis pembatasan, karena satu saja tidak cukup:
 *   1. `rute`  — halaman mana yang boleh dibuka (dijaga di middleware)
 *   2. `uang`  — boleh melihat angka rupiah atau tidak
 *
 * Lapis kedua penting: tim gudang tetap perlu membuka halaman Pesanan
 * dan Master SKU untuk bekerja, tapi tidak boleh melihat nilai pesanan
 * maupun HPP. Memblokir halamannya saja akan melumpuhkan pekerjaan mereka.
 */
/**
 * ── Peran ──
 *
 * Peran tidak lagi ditulis di kode; semuanya tersimpan di tabel `roles`
 * dan bisa dibuat sendiri lewat halaman Pengguna.
 *
 * Dua lapis pemeriksaan, karena middleware berjalan di edge runtime dan
 * tidak bisa menyentuh Postgres:
 *   1. middleware — membaca izin yang dititipkan di cookie saat login.
 *      Cepat, tapi bisa basi kalau peran baru saja diubah.
 *   2. Shell      — membaca ulang dari database tiap halaman dirender,
 *      jadi perubahan peran langsung berlaku tanpa menunggu login ulang.
 */

/** Semua halaman yang bisa diberi izin, untuk daftar centang. */
export const HALAMAN = [
  { rute: '/',              label: 'Dashboard',        grup: 'Ringkasan' },
  { rute: '/realtime',      label: 'Laporan Realtime', grup: 'Ringkasan' },
  { rute: '/laporan-toko',  label: 'Laporan Toko',     grup: 'Ringkasan' },
  { rute: '/keuangan',      label: 'Keuangan',         grup: 'Ringkasan' },
  { rute: '/pesanan',       label: 'Pesanan',          grup: 'Operasional' },
  { rute: '/produk',        label: 'Produk',           grup: 'Operasional' },
  { rute: '/salin-listing', label: 'Salin Listing',    grup: 'Operasional' },
  { rute: '/boost',         label: 'Boost Otomatis',   grup: 'Operasional' },
  { rute: '/master-sku',    label: 'Master SKU',       grup: 'Operasional' },
  { rute: '/gudang',        label: 'Gudang',           grup: 'Operasional' },
  { rute: '/toko',          label: 'Toko Terhubung',   grup: 'Sistem' },
  { rute: '/antrean',       label: 'Antrean Tugas',    grup: 'Sistem' },
];

export async function daftarPeran() {
  return q(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id)::int AS jumlah_akun
            FROM roles r ORDER BY r.bawaan DESC, r.nama`);
}

export async function peranDari(id) {
  if (!id) return null;
  return one('SELECT * FROM roles WHERE id = $1', [id]);
}

export function bolehRute(peran, path) {
  const rute = peran?.rute || [];
  if (rute.includes('*')) return true;
  return rute.some((r) => (r === '/' ? path === '/' : path === r || path.startsWith(r + '/')));
}
export const bolehUang = (peran) => !!peran?.uang;
export const bolehKelola = (peran) => !!peran?.kelola;

/** Halaman pertama yang layak dibuka peran ini. */
export function rutePertama(peran) {
  const rute = peran?.rute || [];
  if (rute.includes('*')) return '/';
  return rute[0] || '/pesanan';
}

// ── Kata sandi ──
export function buatHash(sandi) {
  const garam = crypto.randomBytes(16).toString('hex');
  const kunci = crypto.scryptSync(String(sandi), garam, 32).toString('hex');
  return `scrypt$${garam}$${kunci}`;
}
export function cocokHash(sandi, tersimpan) {
  try {
    const [algo, garam, kunci] = String(tersimpan).split('$');
    if (algo !== 'scrypt') return false;
    const uji = crypto.scryptSync(String(sandi), garam, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(uji, 'hex'), Buffer.from(kunci, 'hex'));
  } catch { return false; }
}

// ── Cookie bertanda tangan ──
// Isinya dibaca middleware TANPA menyentuh database, karena middleware
// berjalan di edge runtime dan tidak bisa membuka koneksi Postgres.
const RAHASIA = () => process.env.APP_SESSION_TOKEN || 'dev-token';
export const COOKIE = 'nsc_session';

export function buatTiket({ id, peran, nama, rute = [], uang = false, kelola = false, master = false }) {
  // Izin ikut dititipkan supaya middleware — yang tidak bisa menyentuh
  // database — tetap bisa menjaga rute.
  const isi = Buffer.from(JSON.stringify({
    id, peran, nama, rute, uang, kelola, master: !!master,
    exp: Date.now() + 30 * 24 * 3600 * 1000,
  })).toString('base64url');
  const tanda = crypto.createHmac('sha256', RAHASIA()).update(isi).digest('base64url');
  return `${isi}.${tanda}`;
}

export function bacaTiket(nilai) {
  if (!nilai || !nilai.includes('.')) return null;
  const [isi, tanda] = nilai.split('.');
  const benar = crypto.createHmac('sha256', RAHASIA()).update(isi).digest('base64url');
  if (tanda !== benar) return null;
  try {
    const data = JSON.parse(Buffer.from(isi, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

/** Pengguna yang sedang masuk, dibaca dari cookie. */
export function sesi() {
  return bacaTiket(cookies().get(COOKIE)?.value);
}

/**
 * Selama belum ada pengguna sama sekali, APP_PASSWORD lama tetap berlaku
 * sebagai pemilik — supaya kamu tidak terkunci di luar aplikasimu sendiri
 * setelah pembaruan ini.
 */
export async function adaPengguna() {
  const r = await one(`SELECT COUNT(*)::int AS n FROM users WHERE aktif = true`);
  return Number(r?.n || 0) > 0;
}

/**
 * ── Akun master ──
 *
 * Ditentukan lewat variabel Railway, bukan lewat database. Tujuannya satu:
 * jalan masuk yang TIDAK BISA hilang karena kesalahan di dalam aplikasi —
 * peran yang salah diatur, akun sendiri dinonaktifkan, atau tabel pengguna
 * rusak. Selalu berperan pemilik penuh.
 *
 * Karena tidak tersimpan di database, akun ini juga tidak bisa dihapus atau
 * diubah izinnya dari halaman Pengguna. Konsekuensinya: siapa pun yang bisa
 * membaca variabel Railway bisa masuk sebagai pemilik, jadi kata sandinya
 * harus kuat dan jangan dipakai sehari-hari.
 */
export function akunMaster() {
  const u = (process.env.MASTER_USERNAME || '').trim();
  const p = process.env.MASTER_PASSWORD || '';
  if (!u || p.length < 12) return null;   // terlalu pendek = dianggap belum diatur
  return { username: u, sandi: p };
}

function samaAman(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export async function masuk(username, sandi) {
  const nama = String(username || '').trim();

  // Akun master diperiksa PALING AWAL supaya tetap bisa masuk walau
  // database bermasalah atau perannya kacau.
  const m = akunMaster();
  if (m && nama.toLowerCase() === m.username.toLowerCase() && samaAman(sandi, m.sandi)) {
    return {
      id: 0, nama: `${m.username} (master)`, roleId: null, peran: 'Master',
      rute: ['*'], uang: true, kelola: true, master: true,
    };
  }

  const u = await one(
    `SELECT u.*, r.nama AS peran_nama, r.rute, r.uang, r.kelola
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     WHERE lower(u.username) = lower($1) AND u.aktif = true`, [nama]);

  if (u && cocokHash(sandi, u.password_hash)) {
    await q(`UPDATE users SET last_login = now() WHERE id = $1`, [u.id]);
    return {
      id: u.id, nama: u.nama, roleId: u.role_id,
      peran: u.peran_nama || 'Tanpa peran',
      rute: u.rute || [], uang: !!u.uang, kelola: !!u.kelola,
    };
  }

  // Selama belum ada pengguna, kata sandi lama tetap berlaku sebagai
  // pemilik supaya kamu tidak terkunci di luar aplikasimu sendiri.
  if (!(await adaPengguna()) && process.env.APP_PASSWORD && sandi === process.env.APP_PASSWORD) {
    return { id: 0, nama: 'Pemilik', roleId: null, peran: 'Pemilik',
             rute: ['*'], uang: true, kelola: true };
  }
  return null;
}

/**
 * Peran terkini dari database. Dipakai Shell tiap halaman dirender, jadi
 * perubahan peran langsung berlaku — tidak menunggu pengguna login ulang.
 */
export async function peranSekarang() {
  const s = sesi();
  if (!s) return null;
  // Akun master & login darurat tidak punya baris di tabel users.
  if (!s.id) return { nama: s.peran, rute: s.rute, uang: s.uang, kelola: s.kelola, master: !!s.master };
  const r = await one(
    `SELECT r.nama, r.rute, r.uang, r.kelola FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.aktif = true`, [s.id]);
  if (!r) return null;
  return { nama: r.nama || 'Tanpa peran', rute: r.rute || [], uang: !!r.uang, kelola: !!r.kelola };
}
