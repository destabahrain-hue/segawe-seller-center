import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Melihat isi tabel ad_spend apa adanya, dibandingkan omzet harian.
 *
 * Dipakai untuk memastikan angka biaya iklan yang janggal berasal dari
 * data Shopee, bukan dari kesalahan penjumlahan di aplikasi.
 * Pakai: /api/diagnosa-iklan?hari=30
 */
export async function GET(req) {
  try {
    await ensureSchema();
    const hari = Math.min(Math.max(Number(new URL(req.url).searchParams.get('hari')) || 30, 1), 180);

    const [perToko, perHari, ringkas, omzet] = await Promise.all([
      q(`SELECT a.shop_id, s.shop_name,
                COUNT(*)::int          AS jumlah_hari,
                MIN(a.day)             AS terawal,
                MAX(a.day)             AS terakhir,
                COALESCE(SUM(a.expense),0) AS total,
                COALESCE(MAX(a.expense),0) AS harian_tertinggi,
                COALESCE(AVG(a.expense),0) AS harian_rata
         FROM ad_spend a LEFT JOIN shops s ON s.shop_id = a.shop_id
         WHERE a.day >= CURRENT_DATE - $1::int
         GROUP BY a.shop_id, s.shop_name
         ORDER BY 6 DESC`, [hari]),

      q(`SELECT a.day, COALESCE(SUM(a.expense),0) AS iklan, COUNT(*)::int AS baris_toko
         FROM ad_spend a
         WHERE a.day >= CURRENT_DATE - $1::int
         GROUP BY a.day ORDER BY a.day DESC LIMIT 40`, [hari]),

      q(`SELECT COUNT(*)::int AS baris, COUNT(DISTINCT shop_id)::int AS toko,
                COUNT(DISTINCT day)::int AS hari, COALESCE(SUM(expense),0) AS total
         FROM ad_spend WHERE day >= CURRENT_DATE - $1::int`, [hari]),

      q(`SELECT COALESCE(SUM(oi.qty * oi.price),0) AS omzet, COUNT(DISTINCT o.id)::int AS pesanan
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.created_time >= CURRENT_DATE - $1::int
           AND COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')`, [hari]),
    ]);

    const totalIklan = Number(ringkas[0]?.total || 0);
    const totalOmzet = Number(omzet[0]?.omzet || 0);

    return NextResponse.json({
      ok: true,
      periode: `${hari} hari terakhir`,
      ringkas: {
        ...ringkas[0],
        omzet: totalOmzet,
        iklan_persen_omzet: totalOmzet ? Number(((totalIklan / totalOmzet) * 100).toFixed(1)) : null,
        catatan: 'Kalau iklan_persen_omzet jauh di atas 15%, periksa apakah '
               + 'harian_tertinggi masuk akal untuk satu toko satu hari.',
      },
      per_toko: perToko,
      per_hari: perHari,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
