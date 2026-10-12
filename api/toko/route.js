import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { antrikanTarik, tarikAwal, statusTarik, statusTarikSemua } from '@/lib/tarik';
import { jalankanAntrean } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Kemajuan penarikan — dipanggil berulang oleh bilah di halaman Toko. */
export async function GET(req) {
  await ensureSchema();
  const shopId = new URL(req.url).searchParams.get('shop_id');
  return NextResponse.json({ ok: true,
    status: shopId ? { [shopId]: await statusTarik(shopId) } : await statusTarikSemua() });
}

export async function POST(req) {
  try {
    await ensureSchema();
    const b = await req.json();
    if (!b.shop_id) return NextResponse.json({ ok: false, error: 'shop_id kosong' }, { status: 400 });

    const hasil = b.bagian === 'semua' || !b.bagian
      ? await tarikAwal(b.shop_id, { hari: b.hari })
      : { [b.bagian]: await antrikanTarik(b.shop_id, b.bagian, { hari: b.hari }) };

    // Kerjakan satu tugas dulu supaya bilahnya langsung bergerak; sisanya
    // dilanjutkan penjadwal.
    await jalankanAntrean({ maks: 1, budgetMs: 20000 }).catch(() => {});
    return NextResponse.json({ ok: true, hasil, status: await statusTarik(b.shop_id) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
