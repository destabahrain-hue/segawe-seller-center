/**
 * Service worker Segawe Seller Center.
 *
 * SENGAJA TIDAK MENYIMPAN DATA. Yang disimpan hanya berkas statis buatan
 * Next (JS/CSS ber-hash) dan ikon. Halaman, API, stok, dan pesanan selalu
 * diambil dari jaringan — stok basi yang terlihat "benar" jauh lebih
 * berbahaya daripada halaman yang sedikit lebih lambat.
 *
 * Nama cache dinaikkan setiap kali aturan di berkas ini berubah, supaya
 * versi lama benar-benar dibuang.
 */
const CACHE = 'nsc-statis-v1';
const BOLEH_SIMPAN = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  /^\/(icon-192|icon-512|maskable-512|favicon)\.(png|ico)$/.test(url.pathname) ||
  url.hostname === 'fonts.gstatic.com';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nama = await caches.keys();
    await Promise.all(nama.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!BOLEH_SIMPAN(url)) return;   // biarkan jaringan menangani, tanpa campur tangan

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const simpanan = await cache.match(req);
    if (simpanan) return simpanan;
    const jawab = await fetch(req);
    // Hanya simpan yang benar-benar berhasil; jangan pernah menyimpan galat.
    if (jawab && jawab.status === 200 && (jawab.type === 'basic' || jawab.type === 'cors')) {
      cache.put(req, jawab.clone());
    }
    return jawab;
  })());
});

// Dipakai tombol "Pasang aplikasi" untuk memaksa versi baru dipakai.
self.addEventListener('message', (e) => { if (e.data === 'lewati') self.skipWaiting(); });
