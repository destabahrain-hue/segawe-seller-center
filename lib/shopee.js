import crypto from 'node:crypto';
import { EP, JEDA_MS } from './endpoints';

const HOST = () => {
  const h = (process.env.SHOPEE_HOST || '').replace(/\/+$/, '');
  // Tanpa penjaga ini, URL jadi relatif dan errornya berbunyi
  // "Failed to parse URL" — tidak menunjuk penyebab sebenarnya.
  if (!h) throw new Error('SHOPEE_HOST belum diisi di environment variable');
  return h;
};
const PARTNER_ID  = () => String(process.env.SHOPEE_PARTNER_ID || '');
const PARTNER_KEY = () => process.env.SHOPEE_PARTNER_KEY || '';

export const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

function hmac(base) {
  return crypto.createHmac('sha256', PARTNER_KEY()).update(base).digest('hex');
}

/**
 * Base string tanda tangan. Urutan TIDAK BOLEH tertukar dan
 * path harus diawali /api/v2 tanpa host.
 *   publik     : partner_id + path + timestamp
 *   shop-level : partner_id + path + timestamp + access_token + shop_id
 */
export function signFor(path, timestamp, { accessToken, shopId } = {}) {
  let base = PARTNER_ID() + path + timestamp;
  if (accessToken && shopId) base += accessToken + String(shopId);
  return hmac(base);
}

/** URL otorisasi yang dibuka seller untuk menyetujui aplikasi. */
export function authUrl() {
  const ts = Math.floor(Date.now() / 1000);
  const path = EP.authPartner.path;
  const redirect = `${(process.env.APP_URL || '').replace(/\/+$/, '')}/api/auth/callback`;
  const p = new URLSearchParams({
    partner_id: PARTNER_ID(),
    timestamp: String(ts),
    sign: signFor(path, ts),
    redirect,
  });
  return `${HOST()}${path}?${p.toString()}`;
}

/**
 * Halaman Shopee untuk MENCABUT izin aplikasi atas sebuah toko.
 * Memutuskan di aplikasi kita saja tidak mencabut izin di sisi Shopee —
 * pencabutan sesungguhnya harus dilakukan seller lewat halaman ini.
 */
export function cancelAuthUrl() {
  const ts = Math.floor(Date.now() / 1000);
  const path = EP.cancelAuth.path;
  const redirect = `${(process.env.APP_URL || '').replace(/\/+$/, '')}/toko?hasil=dicabut`;
  const p = new URLSearchParams({
    partner_id: PARTNER_ID(),
    timestamp: String(ts),
    sign: signFor(path, ts),
    redirect,
  });
  return `${HOST()}${path}?${p.toString()}`;
}

/** Panggilan generik. `ep` adalah salah satu entri dari EP. */
/**
 * `kosongBoleh` menyebut nama parameter yang TETAP dikirim walau isinya
 * string kosong.
 *
 * Bawaannya parameter kosong dibuang — itu benar untuk hampir semua
 * endpoint. Tapi get_billing_transaction_info MENOLAK permintaan tanpa
 * `cursor`, dan nilai sah untuk permintaan pertama justru string kosong.
 * Tanpa daftar ini, parameternya dibuang di sini dan Shopee mengeluh
 * soal cursor yang sebenarnya sudah kita kirim.
 */
export async function call(ep, { params = {}, body = null, accessToken, shopId,
                                 kosongBoleh = [] } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const isShop = ep.auth === 'shop';

  if (isShop && (!accessToken || !shopId)) {
    throw new Error(`Endpoint ${ep.path} butuh access_token dan shop_id`);
  }

  const qs = new URLSearchParams({
    partner_id: PARTNER_ID(),
    timestamp: String(ts),
    sign: signFor(ep.path, ts, isShop ? { accessToken, shopId } : {}),
  });
  if (isShop) {
    qs.set('access_token', accessToken);
    qs.set('shop_id', String(shopId));
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (v === '' && !kosongBoleh.includes(k)) continue;
    qs.set(k, String(v));
  }

  const url = `${HOST()}${ep.path}?${qs.toString()}`;
  const init = { method: ep.method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
  if (ep.method === 'POST') init.body = JSON.stringify(body || {});

  const res = await fetch(url, init);
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Balasan Shopee bukan JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }

  if (json.error) {
    const err = new Error(json.message || json.error);
    err.shopeeCode = json.error;
    err.kind = classifyError(json.error, json.message);
    // Isi response ikut dibawa. Shopee sering menaruh alasan sebenarnya
    // di dalam result_list sambil hanya menulis "All failed, please check
    // result_list for detail" di pesan utamanya — kalau response dibuang,
    // alasan itu hilang dan errornya jadi tidak bisa ditindaklanjuti.
    err.respons = json.response ?? null;
    throw err;
  }
  return json;
}

/**
 * Unggah berkas (multipart). Dipakai media_space/upload_image, yang
 * menerima berkas gambar — bukan URL. Jadi gambar sumber diunduh dulu,
 * lalu dikirim ulang sebagai berkas.
 */
export async function callMultipart(ep, { bytes, namaBerkas = 'gambar.jpg', tipe = 'image/jpeg', field = 'image', params = {}, accessToken, shopId } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const isShop = ep.auth === 'shop';
  const qs = new URLSearchParams({
    partner_id: PARTNER_ID(),
    timestamp: String(ts),
    sign: signFor(ep.path, ts, isShop ? { accessToken, shopId } : {}),
  });
  if (isShop) { qs.set('access_token', accessToken); qs.set('shop_id', String(shopId)); }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }

  const form = new FormData();
  form.append(field, new Blob([bytes], { type: tipe }), namaBerkas);

  const res = await fetch(`${HOST()}${ep.path}?${qs.toString()}`, { method: 'POST', body: form });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Balasan Shopee bukan JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (json.error) {
    const err = new Error(json.message || json.error);
    err.shopeeCode = json.error;
    err.kind = classifyError(json.error, json.message);
    // Isi response ikut dibawa. Shopee sering menaruh alasan sebenarnya
    // di dalam result_list sambil hanya menulis "All failed, please check
    // result_list for detail" di pesan utamanya — kalau response dibuang,
    // alasan itu hilang dan errornya jadi tidak bisa ditindaklanjuti.
    err.respons = json.response ?? null;
    throw err;
  }
  return json;
}

/**
 * Panggilan yang balasannya BINER (PDF label), bukan JSON.
 * Kalau Shopee gagal, ia tetap membalas JSON — jadi tipe isi diperiksa dulu
 * dan pesan errornya tetap terbaca, bukan tersaji sebagai berkas rusak.
 */
export async function callBiner(ep, { body = null, params = {}, accessToken, shopId } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({
    partner_id: PARTNER_ID(),
    timestamp: String(ts),
    sign: signFor(ep.path, ts, { accessToken, shopId }),
    access_token: accessToken,
    shop_id: String(shopId),
  });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }

  const res = await fetch(`${HOST()}${ep.path}?${qs.toString()}`, {
    method: ep.method,
    headers: { 'Content-Type': 'application/json' },
    body: ep.method === 'POST' ? JSON.stringify(body || {}) : undefined,
  });

  const tipe = res.headers.get('content-type') || '';
  if (tipe.includes('application/json') || tipe.includes('text/')) {
    const teks = await res.text();
    let j; try { j = JSON.parse(teks); } catch { j = null; }
    const pesan = j?.message || j?.error || teks.slice(0, 200);
    const err = new Error(pesan || `HTTP ${res.status}`);
    err.shopeeCode = j?.error;
    err.kind = classifyError(j?.error, pesan);
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Shopee mengirim berkas kosong');
  return { buf, tipe: tipe || 'application/pdf' };
}

export function classifyError(code = '', message = '') {
  const s = `${code} ${message}`.toLowerCase();
  if (s.includes('rate') || s.includes('too many') || s.includes('frequent')) return 'rate_limit';
  if (s.includes('token') || s.includes('auth') || s.includes('permission') || s.includes('sign')) return 'auth';
  if (s.includes('not whitelisted') || s.includes('shop')) return 'shop_condition';
  return 'lain';
}

/**
 * Apakah kegagalan ini akan berubah kalau dicoba lagi?
 *
 * Dulu antrean mengulang SEMUA kegagalan sampai empat kali. Untuk
 * gangguan jaringan itu benar; untuk penolakan bisnis itu sia-sia dan
 * menyesatkan — tugasnya menggantung dua menit dengan status "Menunggu"
 * padahal jawabannya tidak akan pernah berubah, dan alasannya tidak
 * pernah sampai ke layar.
 *
 * Aturannya dibalik: kalau Shopee sudah memberi KODE penolakan, itu
 * keputusan bisnis — final. Yang diulang hanya yang memang bisa pulih:
 * batas laju, gangguan jaringan, dan galat sistem di sisi Shopee.
 */
const PULIH = /error_server|error_inner|error_network|system error|try again|timeout|timed out|busy|unavailable|temporar/i;

/**
 * Penolakan mana yang berarti "Shopee-nya yang belum siap", bukan
 * "pesanan ini bermasalah"?
 *
 * Daftarnya sengaja SEMPIT dan hanya berisi pola yang sudah benar-benar
 * terlihat di akun ini. Menebak-nebak pola lain berbahaya: pesanan yang
 * sebenarnya butuh ditindak akan diparkir di tab "menunggu" dan didiamkan
 * sampai batas kirimnya lewat. Kalau ada pesan baru yang ternyata masuk
 * kategori ini, tambahkan di sini — pesan mentahnya selalu ditampilkan di
 * layar supaya ketahuan.
 */
const BELUM_SIAP = /ready to be shipped|not ready|being processed|processing, please/i;

export function jenisGagalPack(e) {
  return BELUM_SIAP.test(`${e?.shopeeCode || ''} ${e?.message || ''}`)
    ? 'marketplace' : 'gagal';
}

export function bisaDiulang(e) {
  if (!e) return false;
  if (e.kind === 'rate_limit') return true;
  if (!e.shopeeCode) return true;                       // jaringan atau balasan tak terbaca
  return PULIH.test(`${e.shopeeCode} ${e.message || ''}`);
}

/** Jalankan daftar tugas berurutan dengan jeda — bukan borongan sekaligus. */
export async function beruntun(items, fn, jeda = JEDA_MS) {
  const hasil = [];
  for (let i = 0; i < items.length; i++) {
    hasil.push(await fn(items[i], i));
    if (i < items.length - 1) await tidur(jeda);
  }
  return hasil;
}
