import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi, peranSekarang, bolehUang } from '@/lib/auth';
import { simpanIklanTiktok } from '@/lib/tiktok-laporan';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  // Angka uang: hanya peran yang boleh melihat rupiah yang boleh mengisinya.
  if (!sesi() || !bolehUang(await peranSekarang())) {
    return NextResponse.json({ ok: false, error: 'Tidak punya akses' }, { status: 403 });
  }
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  if (!b.shop_id || !b.hari) {
    return NextResponse.json({ ok: false, error: 'shop_id dan hari wajib diisi' }, { status: 400 });
  }
  try {
    await simpanIklanTiktok(b.shop_id, b.hari, b.biaya, b.catatan || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
