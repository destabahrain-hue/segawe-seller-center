/**
 * Dijalankan sekali saat server Next.js hidup.
 *
 * Sengaja TIDAK mengimpor lib/penjadwal maupun lib/db di sini: berkas ini
 * ikut dikompilasi untuk edge runtime, dan pustaka `pg` tidak bisa jalan di
 * edge — build langsung gagal. Jadi yang dilakukan cuma memanggil rute
 * /api/cron milik aplikasi sendiri lewat loopback, memakai fetch bawaan.
 * Seluruh logikanya tetap satu tempat di lib/penjadwal.js.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (String(process.env.SYNC_OTOMATIS || '').toLowerCase() === 'off') {
    console.log('[penjadwal] dimatikan lewat SYNC_OTOMATIS=off');
    return;
  }
  const rahasia = process.env.CRON_SECRET;
  if (!rahasia) {
    console.log('[penjadwal] CRON_SECRET belum diisi — penjadwal internal tidak dinyalakan');
    return;
  }

  const menit = Math.max(Number(process.env.SYNC_INTERVAL_MENIT || 5), 1);
  const port = process.env.PORT || 3000;
  const alamat = `http://127.0.0.1:${port}/api/cron`;

  async function panggil() {
    try {
      const r = await fetch(alamat, {
        headers: { 'x-cron-secret': rahasia },
        signal: AbortSignal.timeout(55000),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.dilewati) console.log('[penjadwal]', j.ringkas || `HTTP ${r.status}`);
    } catch (e) {
      console.error('[penjadwal] gagal:', String(e.message).slice(0, 160));
    }
  }

  setTimeout(panggil, 25000);                     // beri waktu server siap
  setInterval(panggil, menit * 60 * 1000);
  console.log(`[penjadwal] hidup, tiap ${menit} menit → ${alamat}`);
}
