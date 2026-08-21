import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Pack yang gagal dalam 24 jam terakhir, untuk banner di halaman Pesanan.
 *
 * Sengaja dibaca dari tabel jobs, bukan disimpan terpisah: itu satu-satunya
 * catatan yang pasti sinkron dengan apa yang benar-benar terjadi.
 */
export async function GET() {
  try {
    await ensureSchema();
    const rows = await q(`
      SELECT j.id, j.payload->>'order_sn' AS order_sn, j.last_error, j.finished_at,
             s.shop_name
        FROM jobs j LEFT JOIN shops s ON s.shop_id = j.shop_id
       WHERE j.kind = 'pack_pesanan' AND j.status = 'failed'
         AND j.finished_at > now() - interval '24 hours'
       ORDER BY j.finished_at DESC
       LIMIT 200`);
    return NextResponse.json({ ok: true, gagal: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
