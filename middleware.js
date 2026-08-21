import { NextResponse } from 'next/server';

/**
 * Rute yang boleh diakses tanpa sesi.
 *
 * /api/tiktok/callback ditambahkan karena TikTok Shop mengembalikan
 * pembeli otorisasi ke alamat itu TANPA membawa cookie sesi kita.
 * Kalau tidak dilewatkan, middleware mengalihkannya ke /login dan
 * authorization code hilang begitu saja — persis pola yang dulu
 * menimpa icon.png. Reviewer TikTok pun hanya akan melihat halaman
 * login, bukan callback.
 *
 * Perhatikan bentuk pemeriksaannya: `pathname.startsWith(p + '/')`
 * membuat SELURUH cabang di bawah alamat ini ikut bebas. Jangan
 * menaruh endpoint TikTok lain (sinkron, tarik pesanan, tukar token
 * ulang) di bawah /api/tiktok/callback/... — taruh di /api/tiktok/...
 * supaya tetap terlindungi sesi.
 */
const BEBAS = ['/login', '/api/login', '/api/auth/callback', '/api/tiktok/callback', '/api/cron'];

/**
 * Middleware berjalan di edge runtime: tidak bisa menyentuh Postgres.
 * Karena itu peran ikut dititipkan di dalam cookie bertanda tangan,
 * dan tanda tangannya diperiksa di sini memakai Web Crypto.
 */
function b64urlToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function bacaTiket(nilai, rahasia) {
  if (!nilai || !nilai.includes('.')) return null;
  const [isi, tanda] = nilai.split('.');
  const kunci = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rahasia),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', kunci, new TextEncoder().encode(isi));
  if (bytesToB64url(sig) !== tanda) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(isi)));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

/**
 * Izin dibaca dari tiket, bukan dari daftar tetap — peran kini dibuat
 * sendiri dan tersimpan di database. Middleware tidak bisa menyentuh
 * Postgres, jadi ini lapis pertama; Shell memeriksa ulang ke database
 * tiap halaman supaya perubahan peran langsung berlaku.
 */
function boleh(tiket, path) {
  const r = tiket?.rute || [];
  if (r.includes('*')) return true;
  return r.some((x) => (x === '/' ? path === '/' : path === x || path.startsWith(x + '/')));
}

const IKON = new Set(['/favicon.ico', '/icon.png', '/apple-icon.png']);

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (BEBAS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();
  // Ketiga berkas ikon dilewatkan tanpa memeriksa sesi. Matcher di bawah
  // sudah mengecualikannya, tapi pemeriksaan di sini jadi jaring kedua —
  // ikon yang dialihkan ke /login akan tampil sebagai kotak kosong di tab,
  // dan penyebabnya sulit ditebak karena halamannya sendiri normal.
  if (pathname.startsWith('/_next') || IKON.has(pathname)) return NextResponse.next();

  const tiket = await bacaTiket(req.cookies.get('nsc_session')?.value,
                                process.env.APP_SESSION_TOKEN || 'dev-token');
  if (!tiket) {
    const url = req.nextUrl.clone();
    url.pathname = '/login'; url.search = '';
    return NextResponse.redirect(url);
  }

  // API selain yang bebas: cukup punya tiket sah.
  if (pathname.startsWith('/api/')) return NextResponse.next();

  if (!boleh(tiket, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/dilarang'; url.search = '';
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

/**
 * Berkas ikon dilewatkan tanpa pemeriksaan sesi.
 *
 * favicon.ico sudah dikecualikan sejak dulu, tapi icon.png dan
 * apple-icon.png belum — keduanya kena pengalihan ke /login. Akibatnya
 * ikon tidak muncul di halaman login, dan gagal diambil saat aplikasinya
 * dipasang ke layar utama atau dijadikan bookmark, karena permintaan itu
 * tidak selalu membawa cookie sesi.
 *
 * Ikon bukan data rahasia, jadi tidak ada yang bocor dengan melewatkannya.
 *
 * Callback TikTok TIDAK perlu masuk matcher — matcher hanya menentukan
 * berkas mana yang middleware-nya tidak dijalankan sama sekali, sementara
 * callback tetap perlu melewati fungsi di atas (dan dilepas lewat BEBAS).
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
};
