import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { jalankanAntrean } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { aksi, id } = await req.json();
  if (aksi === 'ulangi') {
    await q(`UPDATE jobs SET status='pending', run_after=now(), last_error=NULL
             WHERE ${id ? 'id = $1' : "status = 'failed'"}`, id ? [id] : []);
  }
  const hasil = await jalankanAntrean({ maks: 10 });
  return NextResponse.json({ ok: true, hasil });
}
