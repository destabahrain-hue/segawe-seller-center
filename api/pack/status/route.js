import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { jalankanAntrean } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dipanggil berulang oleh layar Pack sampai semua tugas tuntas.
 *
 * Sekalian MENDORONG antrean tiap kali ditanya. Tanpa itu layar hanya
 * menonton tugas yang menunggu giliran penjadwal berikutnya, dan orang
 * di depan layar tidak tahu apakah proses masih hidup atau sudah macet.
 */
export async function GET(req) {
  try {
    await ensureSchema();
    const ids = (new URL(req.url).searchParams.get('ids') || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Tidak ada tugas' }, { status: 400 });

    await jalankanAntrean({ maks: 40, budgetMs: 12000 });

    const rows = await q(`
      SELECT j.id, j.status, j.last_error, j.payload->>'order_sn' AS order_sn, s.shop_name
        FROM jobs j LEFT JOIN shops s ON s.shop_id = j.shop_id
       WHERE j.id = ANY($1::bigint[])
       ORDER BY j.id`, [ids]);

    const hitung = { menunggu: 0, jalan: 0, selesai: 0, gagal: 0 };
    for (const r of rows) {
      if (r.status === 'done') hitung.selesai++;
      else if (r.status === 'failed') hitung.gagal++;
      else if (r.status === 'running') hitung.jalan++;
      else hitung.menunggu++;
    }

    return NextResponse.json({
      ok: true,
      tuntas: hitung.menunggu === 0 && hitung.jalan === 0,
      hitung,
      gagal: rows.filter((r) => r.status === 'failed')
        .map((r) => ({ order_sn: r.order_sn, toko: r.shop_name, alasan: r.last_error })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
