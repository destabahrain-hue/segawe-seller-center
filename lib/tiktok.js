import crypto from 'node:crypto';
import { q, one } from './db';

/**
 * ── TikTok Shop Open Platform ──
 *
 * Alurnya berbeda dari Shopee dan itu sumber sebagian besar kebingungan:
 *
 *  1. Toko menekan authorization link → TikTok memanggil callback kita
 *     dengan `code` saja. TIDAK ada shop_id, TIDAK ada state.
 *  2. `code` ditukar jadi access_token di host AUTH (auth.tiktok-shops.com),
 *     bukan host API biasa.
 *  3. Identitas toko baru ketahuan SETELAH itu, lewat /authorization/202309/shops.
 *     Dari situ didapat shop id dan shop_cipher — cipher WAJIB disertakan di
 *     hampir semua panggilan berikutnya, dan berbeda per toko.
 *
 * Tanda tangan TikTok juga bukan MD5 seperti Shopee: HMAC-SHA256 atas
 * gabungan path + parameter terurut (tanpa `sign` dan `access_token`) +
 * badan permintaan, diapit app_secret di kedua ujungnya.
 *
 * BELUM TERBUKTI DENGAN PANGGILAN SUNGGUHAN. Rute /api/tiktok/diagnosa ada
 * justru untuk itu: ia menampilkan balasan mentah TikTok apa adanya, jadi
 * kalau bentuk tanda tangan atau nama endpoint meleset, kelihatan dari
 * pesan galatnya, bukan dari tebakan.
 *
 * CATATAN PENTING soal galat jaringan: fetch() bawaan Node melempar pesan
 * "fetch failed" yang tidak memberi tahu apa-apa — sebab sebenarnya
 * (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, galat TLS) disimpan di properti
 * `cause`. Semua pemanggilan di berkas ini membukanya lewat ambil(), karena
 * tanpa itu satu jam bisa habis untuk menebak-nebak.
 */

/** fetch dengan batas waktu dan pesan galat yang menyebut sebab aslinya. */
async function ambil(url, opsi = {}, { detik = 20 } = {}) {
  const pengatur = new AbortController();
  const jam = setTimeout(() => pengatur.abort(), detik * 1000);
  try {
    return await fetch(url, { ...opsi, signal: pengatur.signal });
  } catch (e) {
    const sebab = e.cause || {};
    const kode = sebab.code || sebab.errno || (e.name === 'AbortError' ? 'TIMEOUT' : null);
    const inti = sebab.message || e.message;
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    const err = new Error(
      `Tidak bisa menghubungi ${host}${kode ? ` — ${kode}` : ''}${inti && inti !== e.message ? `: ${inti}` : ''}`
      + (kode === 'ENOTFOUND' ? ' (nama host tidak ditemukan DNS)'
        : kode === 'TIMEOUT' ? ' (tidak ada jawaban dalam batas waktu)'
        : kode === 'ECONNREFUSED' ? ' (koneksi ditolak)' : ''));
    err.kodeJaringan = kode || 'TIDAK_DIKETAHUI';
    err.host = host;
    throw err;
  } finally { clearTimeout(jam); }
}

const AUTH_HOST = process.env.TIKTOK_AUTH_HOST || 'https://auth.tiktok-shops.com';
/**
 * Host API utama. Namanya "tiktokglobalSHOP", bukan "tiktokglobal" —
 * nama tanpa "shop" TIDAK ADA di DNS, dan itu yang membuat pengambilan
 * daftar toko gagal ENOTFOUND padahal penukaran tokennya sudah berhasil.
 * Dipastikan dari panduan Postman resmi TikTok Shop ("Call your first API").
 */
const API_HOST  = process.env.TIKTOK_API_HOST || 'https://open-api.tiktokglobalshop.com';

const kunci = () => ({
  appKey: process.env.TIKTOK_APP_KEY || '',
  appSecret: process.env.TIKTOK_APP_SECRET || '',
});

function pastiKunci() {
  const k = kunci();
  if (!k.appKey || !k.appSecret) {
    throw new Error('TIKTOK_APP_KEY / TIKTOK_APP_SECRET belum diisi di environment');
  }
  return k;
}

/**
 * Tanda tangan permintaan.
 *
 * `sign` dan `access_token` DIKECUALIKAN dari perhitungan — memasukkannya
 * adalah kesalahan paling umum dan galatnya cuma berbunyi "invalid signature"
 * tanpa menyebut sebabnya.
 */
export function tandaTangan(path, params = {}, body = '') {
  const { appSecret } = pastiKunci();
  const urut = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  const dasar = `${appSecret}${path}${urut}${body}${appSecret}`;
  return crypto.createHmac('sha256', appSecret).update(dasar).digest('hex');
}

/**
 * Jeda antar panggilan per toko + coba ulang saat kena batas laju.
 *
 * TikTok membalas 36009002 "Too many requests" kalau panggilan beruntun
 * terlalu rapat. Menariknya, ini TIDAK menggagalkan otorisasi — cukup
 * mundur sebentar lalu ulangi. Jedanya disimpan per toko supaya penarikan
 * dua toko berbeda tidak saling menghambat.
 */
const KENA_BATAS = 36009002;
const jedaTerakhir = new Map();
const JEDA_MS = Number(process.env.TIKTOK_JEDA_MS) || 350;

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

async function antre(kunciToko) {
  const k = String(kunciToko || 'umum');
  const lalu = jedaTerakhir.get(k) || 0;
  const tunggu = lalu + JEDA_MS - Date.now();
  if (tunggu > 0) await tidur(tunggu);
  jedaTerakhir.set(k, Date.now());
}

/** Panggilan ke host API biasa (bukan host auth). */
export async function panggil(path, {
  method = 'GET', token = null, shopCipher = null, params = {}, body = null, coba = 0,
} = {}) {
  await antre(shopCipher);
  const { appKey } = pastiKunci();
  const isi = body ? JSON.stringify(body) : '';
  const p = { ...params, app_key: appKey, timestamp: Math.floor(Date.now() / 1000) };
  if (shopCipher) p.shop_cipher = shopCipher;
  p.sign = tandaTangan(path, p, isi);

  const url = `${API_HOST}${path}?${new URLSearchParams(p)}`;
  const r = await ambil(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-tts-access-token': token } : {}),
    },
    ...(isi ? { body: isi } : {}),
  });
  const teks = await r.text();
  let json;
  try { json = JSON.parse(teks); }
  catch { throw new Error(`Balasan TikTok bukan JSON (HTTP ${r.status}): ${teks.slice(0, 200)}`); }
  // TikTok selalu HTTP 200; yang menentukan berhasil atau tidak adalah `code`.
  if (json.code !== 0) {
    // Batas laju bukan kegagalan sungguhan: mundur makin lama lalu ulangi.
    // 5 kali percobaan menutupi jeda sampai ~16 detik, cukup untuk lonjakan
    // sesaat tanpa membuat satu tugas menggantung terlalu lama.
    if (json.code === KENA_BATAS && coba < 5) {
      await tidur(1000 * 2 ** coba);
      return panggil(path, { method, token, shopCipher, params, body, coba: coba + 1 });
    }
    const e = new Error(`TikTok ${json.code}: ${json.message || 'tanpa pesan'}`);
    e.kode = json.code; e.balasan = json; e.kenaBatas = json.code === KENA_BATAS;
    throw e;
  }
  return json;
}

/** Tukar authorization code jadi token. Code sekali pakai dan berumur pendek. */
export async function tukarKode(code) {
  const { appKey, appSecret } = pastiKunci();
  // grant_type memang 'authorized_code', BUKAN 'authorization_code' seperti
  // OAuth pada umumnya. Membetulkannya justru membuat permintaan gagal.
  const url = `${AUTH_HOST}/api/v2/token/get?`
    + new URLSearchParams({ app_key: appKey, app_secret: appSecret,
                            auth_code: code, grant_type: 'authorized_code' });
  const r = await ambil(url);
  const json = await r.json().catch(() => null);
  if (!json) throw new Error(`Balasan token TikTok tidak terbaca (HTTP ${r.status})`);
  if (json.code !== 0) throw new Error(`Tukar kode gagal — TikTok ${json.code}: ${json.message}`);
  return json.data;
}

export async function segarkanToken(refreshToken) {
  const { appKey, appSecret } = pastiKunci();
  const url = `${AUTH_HOST}/api/v2/token/refresh?`
    + new URLSearchParams({ app_key: appKey, app_secret: appSecret,
                            refresh_token: refreshToken, grant_type: 'refresh_token' });
  const r = await ambil(url);
  const json = await r.json().catch(() => null);
  if (!json || json.code !== 0) {
    throw new Error(`Segarkan token gagal — ${json ? `${json.code}: ${json.message}` : `HTTP ${r.status}`}`);
  }
  return json.data;
}

/** Toko yang mengotorisasi token ini. Di sinilah shop_cipher didapat. */
export async function daftarToko(token) {
  const json = await panggil('/authorization/202309/shops', { token });
  return json.data?.shops || [];
}

/**
 * Simpan hasil otorisasi.
 *
 * Tabel TERPISAH dari shops. Kalau toko TikTok ikut masuk ke shops, seluruh
 * penyinkron Shopee (yang membaca tokoAktif) akan mencoba memanggil API
 * Shopee dengan token TikTok dan gagal terus-menerus.
 */
export async function simpanToko(dataToken, toko) {
  const kedaluwarsa = dataToken.access_token_expire_in
    ? new Date(Number(dataToken.access_token_expire_in) * 1000) : null;
  const refreshKedaluwarsa = dataToken.refresh_token_expire_in
    ? new Date(Number(dataToken.refresh_token_expire_in) * 1000) : null;

  for (const t of toko) {
    await q(`
      INSERT INTO tiktok_shops (shop_id, shop_name, shop_cipher, shop_code, region, seller_type,
                                seller_name, open_id, access_token, refresh_token,
                                expires_at, refresh_expires_at, status, connected_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active', now())
      ON CONFLICT (shop_id) DO UPDATE SET
        shop_name = EXCLUDED.shop_name, shop_cipher = EXCLUDED.shop_cipher,
        shop_code = EXCLUDED.shop_code, region = EXCLUDED.region,
        seller_type = EXCLUDED.seller_type, seller_name = EXCLUDED.seller_name,
        open_id = EXCLUDED.open_id, access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at,
        refresh_expires_at = EXCLUDED.refresh_expires_at,
        status = 'active', last_error = NULL, connected_at = now()`,
      [String(t.id), t.name || null, t.cipher || null, t.code || null, t.region || null,
       t.seller_type || null, dataToken.seller_name || null, dataToken.open_id || null,
       dataToken.access_token, dataToken.refresh_token, kedaluwarsa, refreshKedaluwarsa]);
  }
  return toko.length;
}

/**
 * Token hidup untuk satu toko. Disegarkan kalau tinggal < 1 jam.
 * Token TikTok berumur 7 hari dan refresh token 1 tahun, jadi selama aplikasi
 * jalan mingguan, otorisasi ulang manual tidak pernah diperlukan.
 */
export async function tokenHidupTiktok(shopId) {
  const t = await one(`SELECT * FROM tiktok_shops WHERE shop_id = $1`, [String(shopId)]);
  if (!t) throw new Error(`Toko TikTok ${shopId} belum terhubung`);
  const sisa = t.expires_at ? new Date(t.expires_at) - new Date() : -1;
  if (sisa > 3600 * 1000) return t;

  const baru = await segarkanToken(t.refresh_token);
  await q(`UPDATE tiktok_shops SET access_token = $2, refresh_token = $3,
             expires_at = $4, refresh_expires_at = $5, status = 'active', last_error = NULL
           WHERE shop_id = $1`,
    [String(shopId), baru.access_token, baru.refresh_token,
     baru.access_token_expire_in ? new Date(Number(baru.access_token_expire_in) * 1000) : null,
     baru.refresh_token_expire_in ? new Date(Number(baru.refresh_token_expire_in) * 1000) : null]);
  return { ...t, access_token: baru.access_token };
}

export async function tokoTiktok() {
  return q(`SELECT shop_id, shop_name, shop_cipher, region, seller_name, status,
                   expires_at, refresh_expires_at, connected_at, last_error, last_sync_at,
                   segar_kursor
              FROM tiktok_shops ORDER BY shop_name NULLS LAST, shop_id`);
}

/**
 * Penguji koneksi mentah — dipakai rute /api/tiktok/uji-koneksi.
 *
 * Memanggil endpoint token TANPA kode yang sah. Kalau TikTok menjawab
 * (walau dengan galat "invalid auth code"), berarti jalur jaringannya
 * hidup dan masalahnya ada di tempat lain. Kalau gagal menyambung, kode
 * jaringannya yang muncul, bukan "fetch failed" yang tidak berarti apa-apa.
 */
export async function ujiKoneksi(host) {
  const mulai = Date.now();
  try {
    const r = await ambil(`${host}/api/v2/token/get?app_key=uji&app_secret=uji`
      + `&auth_code=uji&grant_type=authorized_code`, {}, { detik: 12 });
    const teks = (await r.text()).slice(0, 300);
    return { host, tersambung: true, http: r.status, ms: Date.now() - mulai, balasan: teks };
  } catch (e) {
    return { host, tersambung: false, kode: e.kodeJaringan || null,
             ms: Date.now() - mulai, galat: e.message };
  }
}

/**
 * Link otorisasi toko — supaya toko bisa dihubungkan dari dalam aplikasi,
 * tanpa membuka Partner Center tiap kali.
 *
 * Dua sumber, dicoba berurutan:
 *  1. TIKTOK_AUTH_LINK — tempel UTUH hasil tombol "Copy authorization link"
 *     di Partner Center. Ini sumber paling pasti; bentuk apa pun yang
 *     TikTok berikan, itu yang dipakai.
 *  2. TIKTOK_SERVICE_ID — Service ID aplikasi (deretan angka panjang di
 *     halaman App & Service). Link dibangun dengan pola resmi
 *     services.tiktokshop.com/open/authorize?service_id=...
 *
 * Dua-duanya kosong → null, dan tombol Hubungkan mengarahkan ke penjelasan.
 */
export function linkOtorisasi() {
  const utuh = (process.env.TIKTOK_AUTH_LINK || '').trim();
  if (utuh.startsWith('http')) return utuh;
  const sid = (process.env.TIKTOK_SERVICE_ID || '').trim();
  if (sid) return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(sid)}`;
  return null;
}
