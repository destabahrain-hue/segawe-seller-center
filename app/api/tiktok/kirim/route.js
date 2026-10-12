import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { pratinjauKirim, jalankanKirim } from '@/lib/tiktok-kirim';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Atur kirim TikTok — setara Pack di Shopee.
 *   { ids, pratinjau: true }  → baca status & pilihan serah terima (tidak mengubah apa pun)
 *   { ids, pilihan }          → jalankan Ship Package (TIDAK BISA DIBATALKAN)
 * `ids` = id dari pesanan_v (negatif untuk TikTok).
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const { ids, pratinjau = false, pilihan = null } = await req.json();
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada pesanan dipilih' }, { status: 400 });
    }
    if (ids.some((x) => !String(x).startsWith('-'))) {
      return NextResponse.json({ ok: false,
        error: 'Pilihan berisi pesanan Shopee — atur kirim TikTok hanya untuk pesanan TikTok' }, { status: 400 });
    }
    if (pratinjau) return NextResponse.json({ ok: true, ...(await pratinjauKirim(ids)) });
    const hasil = await jalankanKirim(ids, pilihan, sesi()?.nama || null);
    return NextResponse.json({ ok: true, ...hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
