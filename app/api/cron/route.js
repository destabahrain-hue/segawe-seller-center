import { NextResponse } from 'next/server';
import { sekaliPutaran } from '@/lib/penjadwal';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Jalur CADANGAN. Sinkronisasi utama sudah dijalankan penjadwal internal
 * (lihat instrumentation.js + lib/penjadwal.js). Route ini tetap ada supaya
 * cron dari luar bisa memancing putaran kalau server sempat mati.
 *
 * Kunci giliran di penjadwal mencegah putaran dobel bila keduanya aktif.
 */
export async function GET(req) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'Tidak berwenang' }, { status: 401 });
  }
  const hasil = await sekaliPutaran({ paksa: req.nextUrl.searchParams.get('paksa') === '1' });
  return NextResponse.json({ ok: true, ...hasil });
}
