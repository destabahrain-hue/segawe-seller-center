import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const b = await req.json();
  try {
    await q(
      `INSERT INTO stock_moves (master_sku_id, direction, qty, unit_cost, ref_type, note, moved_at)
       VALUES ($1,$2,$3,$4,'manual',$5, COALESCE($6::timestamptz, now()))`,
      [b.master_sku_id, b.direction || 'in', Number(b.qty) || 0,
       b.unit_cost ? Number(b.unit_cost) : null, b.note || null, b.moved_at || null]);

    // Harga beli sekaligus jadi HPP berlaku — itu inti "isi sekali di master SKU".
    if (b.direction === 'in' && b.unit_cost) {
      await q(
        `INSERT INTO master_sku_hpp (master_sku_id, hpp, effective_from, note)
         VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),'dari stok masuk')
         ON CONFLICT (master_sku_id, effective_from) DO UPDATE SET hpp = EXCLUDED.hpp`,
        [b.master_sku_id, Number(b.unit_cost), b.moved_at || null]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
