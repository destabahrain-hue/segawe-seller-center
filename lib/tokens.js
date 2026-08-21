import { q, one, log } from './db';
import { call } from './shopee';
import { EP } from './endpoints';

const AMBANG_MENIT = 30; // segarkan kalau sisa umur kurang dari ini

function expiresAtDari(expireIn) {
  const detik = Number(expireIn);
  // Penjaga: kalau expire_in tidak masuk akal, pakai 4 jam (umur normal token Shopee).
  const aman = Number.isFinite(detik) && detik > 60 ? detik : 4 * 3600;
  return new Date(Date.now() + aman * 1000);
}

/**
 * PENTING: refresh_token dijaga dengan COALESCE.
 * Di proyek lalu kolom ini pernah tertimpa NULL karena respons refresh
 * tidak selalu menyertakan refresh_token — akibatnya toko mati permanen
 * sampai harus otorisasi ulang.
 */
export async function simpanToken(shopId, data) {
  await q(
    `INSERT INTO shops (shop_id, access_token, refresh_token, expires_at, status, last_error)
     VALUES ($1,$2,$3,$4,'active',NULL)
     ON CONFLICT (shop_id) DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, shops.refresh_token),
       expires_at    = EXCLUDED.expires_at,
       status        = 'active',
       last_error    = NULL`,
    [shopId, data.access_token, data.refresh_token || null, expiresAtDari(data.expire_in)]
  );
}

export async function tukarKode(code, shopId) {
  const json = await call(EP.tokenGet, {
    body: { code, shop_id: Number(shopId), partner_id: Number(process.env.SHOPEE_PARTNER_ID) },
  });
  await simpanToken(shopId, json);
  return json;
}

async function segarkan(shop) {
  if (!shop.refresh_token) throw new Error('Tidak ada refresh_token — toko harus dihubungkan ulang');
  const json = await call(EP.tokenRefresh, {
    body: {
      refresh_token: shop.refresh_token,
      shop_id: Number(shop.shop_id),
      partner_id: Number(process.env.SHOPEE_PARTNER_ID),
    },
  });
  await simpanToken(shop.shop_id, json);
  return json.access_token;
}

/** Kembalikan access_token yang dijamin masih hidup. */
export async function tokenHidup(shopId) {
  const shop = await one('SELECT * FROM shops WHERE shop_id = $1', [shopId]);
  if (!shop) throw new Error(`Toko ${shopId} belum terhubung`);

  const sisaMenit = shop.expires_at
    ? (new Date(shop.expires_at).getTime() - Date.now()) / 60000
    : -1;

  if (shop.access_token && sisaMenit > AMBANG_MENIT) return shop.access_token;

  try {
    return await segarkan(shop);
  } catch (e) {
    await q('UPDATE shops SET status = $2, last_error = $3 WHERE shop_id = $1',
      [shopId, 'perlu_otorisasi_ulang', String(e.message).slice(0, 500)]);
    await log('token', `Gagal menyegarkan token toko ${shopId}: ${e.message}`, { shopId, ok: false });
    throw e;
  }
}

export async function tokoAktif() {
  return q(`SELECT * FROM shops WHERE status = 'active' ORDER BY shop_name NULLS LAST, shop_id`);
}
