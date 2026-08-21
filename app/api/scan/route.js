import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { scanResi, ringkasScan, riwayatScan } from '@/lib/scan';

export const dynamic = 'force-dynamic';

/** Satu tembakan barcode. Sengaja satu resi per panggilan supaya tiap
 *  hasil bisa langsung tampil, tidak menunggu rombongan selesai. */
export async function POST(req) {
  try {
    await ensureSchema();
    const { resi } = await req.json();
    const s = sesi();
    const hasil = await scanResi(resi, s?.nama || null);
    const ringkas = await ringkasScan();
    return NextResponse.json({ ok: true, hasil, ringkas });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

/** Keadaan awal halaman: angka hari ini + riwayat terakhir. */
export async function GET(req) {
  try {
    await ensureSchema();
    const hanyaGagal = new URL(req.url).searchParams.get('gagal') === '1';
    const [ringkas, riwayat] = await Promise.all([
      ringkasScan(),
      riwayatScan({ batas: 50, hanyaGagal }),
    ]);
    return NextResponse.json({ ok: true, ringkas, riwayat });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
