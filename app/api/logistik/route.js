import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tarikLogistikSemua } from '@/lib/logistik';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    await ensureSchema();
    const hasil = await tarikLogistikSemua();
    return NextResponse.json({ ok: true, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
