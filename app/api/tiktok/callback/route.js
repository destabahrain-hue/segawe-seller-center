// app/api/tiktok/callback/route.js
//
// Penampung authorization code dari TikTok Shop Open Platform.
// TAHAP 2: terima code, TUKAR jadi access_token + refresh_token, cari toko
// mana yang barusan mengotorisasi, lalu simpan ke tabel tiktok_shops.
//
// Identitas toko tidak ikut di callback (TikTok cuma mengirim code, app_key,
// locale, shop_region), jadi urutannya memang harus: tukar token dulu, baru
// tanya /authorization/202309/shops siapa pemiliknya.
//
// Alamat ini HARUS sama persis dengan Redirect URL di Partner Center.
// Domain PT Segawe Jaya Mulia:
// https://segawe-seller-center-production.up.railway.app/api/tiktok/callback
// JANGAN pakai domain Numedix — app TikTok Shop-nya beda.

import { tukarKode, daftarToko, simpanToko } from '@/lib/tiktok';
import { ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function aman(nilai) {
  return String(nilai == null ? '' : nilai)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function halaman({ judul, pesan, warna, baris }) {
  const isi = (baris || [])
    .map(
      ([k, v]) =>
        `<tr><th>${aman(k)}</th><td><code>${aman(v) || '<i>kosong</i>'}</code></td></tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${aman(judul)}</title>
<style>
  body{font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:32px;background:#f6f7f9;color:#1a1a1a}
  .kotak{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  h1{margin:0 0 4px;font-size:18px;color:${warna}}
  p{margin:0 0 20px;color:#555}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;width:170px;padding:8px 10px 8px 0;color:#666;font-weight:600;vertical-align:top;border-top:1px solid #eee}
  td{padding:8px 0;border-top:1px solid #eee;word-break:break-all}
  code{background:#f2f3f5;padding:2px 5px;border-radius:4px;font-size:12px}
  .catatan{margin-top:20px;padding:12px 14px;background:#fff8e6;border-left:3px solid #f0b429;border-radius:4px;font-size:13px;color:#6b4e00}
</style></head>
<body><div class="kotak">
  <h1>${aman(judul)}</h1>
  <p>${aman(pesan)}</p>
  <table>${isi}</table>
  <div class="catatan">Toko yang berhasil terhubung tersimpan otomatis. Kalau gagal,
  ulangi dari authorization link — <b>code hanya berlaku sekali dan berumur pendek</b>.</div>
</div></body></html>`;
}

export async function GET(req) {
  const url = new URL(req.url);
  const p = Object.fromEntries(url.searchParams.entries());
  const code = p.code || p.auth_code || '';

  if (!code) {
    return new Response(halaman({
      judul: 'Callback TikTok Shop aktif',
      pesan: 'Alamat ini siap menerima otorisasi, tapi permintaan ini tidak membawa code.',
      warna: '#0f766e',
      baris: Object.entries(p),
    }), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  try {
    await ensureSchema();
    const token = await tukarKode(code);
    const toko = await daftarToko(token.access_token);
    const n = await simpanToko(token, toko);

    return new Response(halaman({
      judul: n ? `${n} toko TikTok terhubung` : 'Token didapat, tapi tidak ada toko',
      pesan: n ? 'Token dan identitas toko sudah tersimpan. Tutup halaman ini.'
               : 'Tukar token berhasil, tapi daftar toko kosong — periksa apakah otorisasi '
                 + 'memang untuk toko yang dimaksud.',
      warna: n ? '#0f766e' : '#b45309',
      baris: [
        ['Penjual', token.seller_name || '—'],
        ['Toko', toko.map((t) => `${t.name} (${t.id})`).join(', ') || '—'],
        ['Region', toko.map((t) => t.region).join(', ') || p.shop_region || '—'],
        ['Token berlaku sampai', token.access_token_expire_in
          ? new Date(Number(token.access_token_expire_in) * 1000).toLocaleString('id-ID') : '—'],
        ['Refresh sampai', token.refresh_token_expire_in
          ? new Date(Number(token.refresh_token_expire_in) * 1000).toLocaleString('id-ID') : '—'],
      ],
    }), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return new Response(halaman({
      judul: 'Gagal menghubungkan toko TikTok',
      pesan: e.message,
      warna: '#b91c1c',
      baris: [
        ['code', `${code.slice(0, 24)}… (${code.length} karakter)`],
        ['app_key', p.app_key || '—'],
        ['shop_region', p.shop_region || '—'],
        ['Langkah berikutnya', 'Ulangi dari authorization link; code sebelumnya sudah hangus.'],
      ],
    }), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}
