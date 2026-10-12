import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { putarSatuToko, naikkan } from '@/lib/boost';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  const b = await req.json();
  try {
    await ensureSchema();

    if (b.aksi === 'setelan') {
      await q(
        `INSERT INTO boost_setting (shop_id, otomatis, slot) VALUES ($1,$2,$3)
         ON CONFLICT (shop_id) DO UPDATE SET
           otomatis = COALESCE(EXCLUDED.otomatis, boost_setting.otomatis),
           slot     = COALESCE(EXCLUDED.slot, boost_setting.slot)`,
        [b.shop_id, b.otomatis ?? null, b.slot ? Number(b.slot) : null]);
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'tambah') {
      for (const id of b.items || []) {
        await q(`INSERT INTO boost_pool (shop_id, item_id) VALUES ($1,$2)
                 ON CONFLICT (shop_id, item_id) DO UPDATE SET aktif = true`, [b.shop_id, id]);
      }
      return NextResponse.json({ ok: true, jumlah: (b.items || []).length });
    }

    if (b.aksi === 'hapus') {
      await q(`DELETE FROM boost_pool WHERE shop_id = $1 AND item_id = ANY($2::bigint[])`,
        [b.shop_id, b.items || []]);
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'sekarang') {
      const hasil = await putarSatuToko(b.shop_id);
      return NextResponse.json({ ok: true, hasil });
    }

    if (b.aksi === 'naikkan-ini') {
      const hasil = await naikkan(b.shop_id, b.items || []);
      return NextResponse.json({ ok: true, hasil });
    }

    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
