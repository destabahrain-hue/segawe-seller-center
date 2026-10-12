export const rp = (n) =>
  'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);

export const num = (n) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);

export const pct = (n, d = 1) =>
  (Number(n) || 0).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';

// timeZone WAJIB: server Railway berjalan di UTC, jadi tanpa ini semua jam
// tampil 7 jam lebih awal (dan tanggal bisa mundur sehari untuk dini hari).
export const jam = (d) =>
  d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                                           timeZone: 'Asia/Jakarta' }) : '—';

export const tgl = (d) =>
  d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric',
                                               timeZone: 'Asia/Jakarta' }) : '—';

// Kunci hari memakai zona Asia/Jakarta, bukan UTC.
export function hariJakarta(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date); // yyyy-mm-dd
}
