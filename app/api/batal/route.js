import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tanggapiBatal } from '@/lib/batal';
import { sesi } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Satu pesanan per permintaan — sengaja tidak ada aksi massal.
 * Menyetujui pembatalan tidak bisa ditarik kembali, jadi tiap keputusan
 * harus ditekan sendiri-sendiri.
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const { id, keputusan } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: 'Pesanan tidak disebutkan' }, { status: 400 });

    const hasil = await tanggapiBatal(id, keputusan, sesi()?.nama || null);
    return NextResponse.json({ ok: true, ...hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
