import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { tokoTiktok, tokenHidupTiktok, daftarToko, panggil, tandaTangan } from '@/lib/tiktok';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pembukti integrasi TikTok.
 *
 * Bentuk tanda tangan dan nama endpoint TikTok belum pernah dibuktikan
 * dengan panggilan sungguhan dari aplikasi ini. Rute ini memanggilnya
 * betulan lalu memulangkan hasil APA ADANYA — termasuk kode galat TikTok —
 * supaya kesalahan kelihatan dari pesan aslinya, bukan dari tebakan.
 *
 * ?path=/order/202309/orders&cipher=1  → coba endpoint lain sekalian.
 */
export async function GET(req) {
  if (!sesi()) return NextResponse.json({ ok: false, error: 'Belum masuk' }, { status: 401 });
  await ensureSchema();
  const u = new URL(req.url);

  const env = {
    app_key: !!process.env.TIKTOK_APP_KEY,
    app_secret: !!process.env.TIKTOK_APP_SECRET,
    host: process.env.TIKTOK_API_HOST || 'https://open-api.tiktokglobal.com (bawaan)',
  };
  const toko = await tokoTiktok();
  if (!toko.length) {
    return NextResponse.json({ ok: true, env, toko: [],
      catatan: 'Belum ada toko TikTok terhubung. Buka authorization link dari Partner Center, '
             + 'lalu TikTok akan memanggil /api/tiktok/callback.' });
  }

  const t = u.searchParams.get('shop_id')
    ? toko.find((x) => x.shop_id === u.searchParams.get('shop_id')) : toko[0];
  const hasil = {};

  try {
    const hidup = await tokenHidupTiktok(t.shop_id);
    hasil.token = 'ok (disegarkan bila perlu)';
    try {
      hasil.shops = await daftarToko(hidup.access_token);
    } catch (e) { hasil.shops = { galat: e.message, kode: e.kode || null }; }

    const path = u.searchParams.get('path');
    if (path) {
      try {
        const json = await panggil(path, {
          token: hidup.access_token,
          shopCipher: u.searchParams.get('cipher') === '0' ? null : t.shop_cipher,
          params: { page_size: 10 },
        });
        hasil.uji = { path, ringkas: Object.keys(json.data || {}), contoh: json.data };
      } catch (e) { hasil.uji = { path, galat: e.message, kode: e.kode || null }; }
    }
  } catch (e) {
    hasil.token = { galat: e.message };
  }

  return NextResponse.json({
    ok: true, env,
    toko: toko.map((x) => ({ shop_id: x.shop_id, nama: x.shop_name, region: x.region,
                             punya_cipher: !!x.shop_cipher, status: x.status,
                             token_sampai: x.expires_at, refresh_sampai: x.refresh_expires_at })),
    diuji: t.shop_name || t.shop_id,
    contoh_tanda_tangan: tandaTangan('/authorization/202309/shops',
      { app_key: 'X', timestamp: 1700000000 }).slice(0, 16) + '…',
    ...hasil,
  });
}
