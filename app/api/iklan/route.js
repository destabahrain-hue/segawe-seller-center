import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tarikIklanSemua } from '@/lib/iklan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    await ensureSchema();
    const { hari = 30 } = await req.json().catch(() => ({}));
    const hasil = await tarikIklanSemua({ hariKeBelakang: Math.min(Math.max(Number(hari) || 30, 1), 180) });
    return NextResponse.json({ ok: true, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
