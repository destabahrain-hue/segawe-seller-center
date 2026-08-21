import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sinkronSemua } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    await ensureSchema();
    const hari = Number(new URL(req.url).searchParams.get('hari') || 2);
    const hasil = await sinkronSemua({ hariKeBelakang: hari });
    return NextResponse.json({ ok: true, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
