import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tarikProdukSemua } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url);
    const hasil = await tarikProdukSemua({
      maksModel: Number(u.searchParams.get('model') || 120),
      status: u.searchParams.get('status') || 'NORMAL',
    });
    return NextResponse.json({ ok: true, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
