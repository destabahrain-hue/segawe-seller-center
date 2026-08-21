import { NextResponse } from 'next/server';
import { ensureSchema, q, one } from '@/lib/db';
import { antrikan, jalankanAntrean } from '@/lib/queue';
import { tokoAktif } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Antrikan penarikan riwayat pesanan ke belakang.
 * Shopee membatasi rentang per panggilan (15 hari), jadi dipotong 14 hari
 * per tugas dan dikerjakan bertahap oleh penjadwal.
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const { hari = 90 } = await req.json().catch(() => ({}));
    const n = Math.min(Math.max(Number(hari) || 90, 1), 365);

    const toko = await tokoAktif();
    if (!toko.length) {
      return NextResponse.json({ ok: false, error: 'Belum ada toko aktif' }, { status: 400 });
    }

    const sekarang = Math.floor(Date.now() / 1000);
    const mulai = sekarang - n * 86400;
    let tugas = 0;
    for (const t of toko) {
      for (let a = mulai; a < sekarang; a += 14 * 86400) {
        const b = Math.min(a + 14 * 86400, sekarang);
        await antrikan('tarik_riwayat', { shopId: t.shop_id, payload: { dari: a, sampai: b } });
        tugas++;
      }
    }

    // Kerjakan satu-dua dulu supaya kamu langsung melihat pergerakan.
    const hasil = await jalankanAntrean({ maks: 2, budgetMs: 30000 });
    return NextResponse.json({ ok: true, tugas, toko: toko.length, hari: n, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

/** Sejak kapan data yang ada, dan berapa tugas riwayat yang masih menunggu. */
export async function GET() {
  try {
    await ensureSchema();
    const r = await one(`
      SELECT MIN(created_time) AS terawal, MAX(created_time) AS terakhir, COUNT(*)::int AS jumlah
      FROM orders`);
    const a = await one(`
      SELECT COUNT(*)::int AS menunggu FROM jobs
      WHERE kind = 'tarik_riwayat' AND status IN ('pending','running')`);
    return NextResponse.json({ ok: true, ...r, menunggu: Number(a?.menunggu || 0) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
