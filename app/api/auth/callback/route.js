import { NextResponse } from 'next/server';
import { ensureSchema, q, log } from '@/lib/db';
import { tukarKode } from '@/lib/tokens';
import { tarikNamaToko } from '@/lib/sync';

export const dynamic = 'force-dynamic';

/**
 * Shopee mengarahkan seller ke sini setelah menyetujui aplikasi.
 * PENTING: alamat tujuan dibangun dari APP_URL, bukan request.url —
 * di Railway request.url berisi localhost:8080 dan bikin redirect gagal.
 */
export async function GET(req) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const shopId = url.searchParams.get('shop_id');

  if (!code || !shopId) {
    return NextResponse.redirect(`${base}/toko?hasil=kurang_parameter`);
  }

  try {
    await ensureSchema();
    await q(`INSERT INTO shops (shop_id) VALUES ($1) ON CONFLICT (shop_id) DO NOTHING`, [shopId]);
    await tukarKode(code, shopId);
    await tarikNamaToko(shopId).catch(() => {});
    await log('oauth', `Toko ${shopId} berhasil dihubungkan`, { shopId });
    return NextResponse.redirect(`${base}/toko?hasil=berhasil&shop=${shopId}`);
  } catch (e) {
    await log('oauth', `Gagal menghubungkan toko ${shopId}: ${e.message}`, { shopId, ok: false });
    return NextResponse.redirect(`${base}/toko?hasil=gagal&pesan=${encodeURIComponent(e.message)}`);
  }
}
