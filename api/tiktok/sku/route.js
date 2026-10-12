import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { cocokkanOtomatis, tautkanSku } from '@/lib/tiktok-laporan';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!sesi()) return NextResponse.json({ ok: false, error: 'Belum masuk' }, { status: 401 });
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  try {
    if (b.aksi === 'cocokkan') return NextResponse.json({ ok: true, ...(await cocokkanOtomatis()) });
    if (b.aksi === 'tautkan') {
      await tautkanSku(b.shop_id, b.seller_sku, b.master_sku_id || null);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
