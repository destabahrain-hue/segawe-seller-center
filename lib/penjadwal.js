import { ensureSchema, q, one, log } from './db';

/**
 * ── Penjadwal internal ──
 *
 * Sinkronisasi dijalankan sendiri oleh server, tidak menunggu cron dari luar.
 * Alasannya pengalaman Ad Storm: cron-job.org pernah gagal 502 saat ada
 * banyak deploy berturut-turut, dan kegagalannya baru diketahui lewat email.
 * Penjadwal di dalam proses tidak punya titik gagal itu.
 *
 * /api/cron tetap ada sebagai jalur cadangan — boleh dipakai bersamaan,
 * kunci giliran di bawah mencegah keduanya jalan berbarengan.
 */
const MENIT = () => Math.max(Number(process.env.SYNC_INTERVAL_MENIT || 5), 1);
let hidup = false;

/**
 * Ambil giliran lewat satu UPDATE bersyarat. Kalau ada instance lain
 * (atau cron luar) yang baru saja jalan, baris tidak ikut terpilih dan
 * putaran ini dilewati — jadi tidak pernah dobel.
 */
async function ambilGiliran(nama, detik) {
  await q(`INSERT INTO jadwal (nama) VALUES ($1) ON CONFLICT (nama) DO NOTHING`, [nama]);
  const r = await one(
    `UPDATE jadwal SET last_run = now()
     WHERE nama = $1
       AND (last_run IS NULL OR last_run < now() - make_interval(secs => $2))
     RETURNING nama`, [nama, detik]);
  return !!r;
}

async function catat(nama, teks) {
  await q(`UPDATE jadwal SET last_note = $2 WHERE nama = $1`, [nama, String(teks).slice(0, 400)])
    .catch(() => {});
}

export async function sekaliPutaran({ paksa = false } = {}) {
  await ensureSchema();
  const detik = MENIT() * 60 - 20;   // toleransi 20 detik agar tidak terlewat
  if (!paksa && !(await ambilGiliran('sinkron', detik))) return { dilewati: true };

  const ringkas = [];
  try {
    const { jalankanAntrean } = await import('./queue');
    const a = await jalankanAntrean({ maks: 40, budgetMs: 15000 });
    ringkas.push(`antrean ${a.selesai} selesai`);
  } catch (e) { ringkas.push(`antrean gagal: ${e.message}`); }

  try {
    const { sinkronSemua } = await import('./sync');
    const s = await sinkronSemua({ hariKeBelakang: 3 });   // 3 hari, disaring update_time
    const p = s.reduce((n, x) => n + (x.pesanan || 0), 0);
    const gagal = s.filter((x) => !x.ok).length;
    ringkas.push(`${p} pesanan${gagal ? `, ${gagal} toko gagal` : ''}`);
  } catch (e) { ringkas.push(`sinkron gagal: ${e.message}`); }

  try {
    // Tanggal pencairan datang dari endpoint terpisah (get_escrow_list) dan
    // riwayatnya panjang, jadi disapu sedikit-sedikit tiap putaran. Tanpa
    // ini Laporan Mingguan tidak akan pernah terisi.
    const { sapuCairSemua } = await import('./sync');
    const c = await sapuCairSemua({ potongan: 2, hariPerPotong: 7 });
    const t = c.reduce((n, x) => n + (x.terisi || 0), 0);
    const g = c.filter((x) => !x.ok).length;
    if (t || g) ringkas.push(`tanggal cair ${t}${g ? `, ${g} toko gagal` : ''}`);
  } catch (e) { ringkas.push(`tanggal cair gagal: ${e.message}`); }

  try {
    const { tarikLogistikSemua } = await import('./logistik');
    const l = await tarikLogistikSemua();
    const r = l.reduce((a, x) => a + (x.resi || 0), 0);
    const j = l.reduce((a, x) => a + (x.jejak || 0), 0);
    if (r || j) ringkas.push(`${r} resi, ${j} jejak`);
  } catch (e) { ringkas.push(`logistik gagal: ${e.message}`); }

  try {
    const { tarikIklanSemua } = await import('./iklan');
    const i = await tarikIklanSemua({ hariKeBelakang: 3 });
    const okI = i.filter((x) => x.ok).length;
    if (i.length) ringkas.push(`iklan ${okI}/${i.length} toko`);
  } catch (e) { ringkas.push(`iklan gagal: ${e.message}`); }

  try {
    const { putarSemua } = await import('./boost');
    const b = await putarSemua();
    if (b.length) ringkas.push(`boost ${b.length} toko`);
  } catch (e) { ringkas.push(`boost gagal: ${e.message}`); }

  await catat('sinkron', ringkas.join(' · '));
  return { dilewati: false, ringkas: ringkas.join(' · ') };
}

export function mulaiPenjadwal() {
  if (hidup) return;
  hidup = true;
  const jeda = MENIT() * 60 * 1000;

  // Jangan langsung jalan saat server baru hidup — beri waktu koneksi DB siap.
  setTimeout(() => { sekaliPutaran().catch((e) => console.error('[penjadwal]', e.message)); }, 25000);
  setInterval(() => { sekaliPutaran().catch((e) => console.error('[penjadwal]', e.message)); }, jeda);

  console.log(`[penjadwal] hidup, tiap ${MENIT()} menit`);
  log('penjadwal', `Penjadwal internal hidup, tiap ${MENIT()} menit`).catch(() => {});
}
