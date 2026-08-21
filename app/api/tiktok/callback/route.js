// app/api/tiktok/callback/route.js
//
// Penampung authorization code dari TikTok Shop Open Platform.
// TAHAP 1 (berkas ini): terima code, catat ke log, tampilkan di layar.
// TAHAP 2 (nanti): tukar code jadi access_token + refresh_token, simpan per toko.
//
// Alamat ini HARUS sama persis dengan Redirect URL di Partner Center.
// GANTI dengan domain Railway milik PT Segawe Jaya Mulia, contoh:
// https://<domain-segawe>.up.railway.app/api/tiktok/callback
// JANGAN pakai domain Numedix — app TikTok Shop-nya beda.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  <div class="catatan">Tahap penampungan. Code ini <b>berumur pendek</b> dan sekali pakai —
  salin sekarang kalau mau dipakai uji tukar token secara manual.</div>
</div></body></html>`;
}

export async function GET(req) {
  const url = new URL(req.url);
  const p = Object.fromEntries(url.searchParams.entries());

  // TikTok memakai `code`; sebagian dokumen lama menyebutnya `auth_code`.
  // Terima keduanya supaya tidak gagal karena beda penamaan.
  const code = p.code || p.auth_code || '';

  // Catat SELURUH parameter apa adanya. Ini satu-satunya cara tahu bentuk
  // balikan yang sebenarnya tanpa menebak dari dokumentasi.
  console.log('[tiktok-callback]', new Date().toISOString(), JSON.stringify(p));

  if (p.error || p.error_description) {
    return new Response(
      halaman({
        judul: 'Otorisasi ditolak',
        pesan: 'TikTok mengembalikan galat, bukan authorization code.',
        warna: '#c0392b',
        baris: [
          ['error', p.error],
          ['error_description', p.error_description],
          ['state', p.state],
        ],
      }),
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }

  if (!code) {
    // Dibuka langsung tanpa lewat alur otorisasi (mis. dicek reviewer atau uptime check).
    // Sengaja balas 200, BUKAN 404 — supaya alamatnya terbukti hidup.
    return new Response(
      halaman({
        judul: 'Callback TikTok Shop aktif',
        pesan: 'Alamat ini siap menerima authorization code. Belum ada code pada permintaan ini.',
        warna: '#0f766e',
        baris: [['parameter diterima', Object.keys(p).join(', ')]],
      }),
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }

  return new Response(
    halaman({
      judul: 'Authorization code diterima',
      pesan: 'Code berhasil ditangkap. Penukaran jadi access_token belum dibangun.',
      warna: '#0f766e',
      baris: [
        ['code', code],
        ['state', p.state],
        ['app_key', p.app_key],
        ['shop_region', p.shop_region],
        ['locale', p.locale],
        ['seluruh parameter', JSON.stringify(p)],
      ],
    }),
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

// TikTok memakai GET untuk redirect. POST disediakan hanya sebagai jaring
// pengaman supaya tidak balas 405 kalau ternyata dipanggil dengan metode lain.
export async function POST(req) {
  let badan = '';
  try {
    badan = await req.text();
  } catch {}
  console.log('[tiktok-callback][POST]', new Date().toISOString(), badan.slice(0, 2000));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
