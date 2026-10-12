import { NextResponse } from 'next/server';
import { ensureSchema, one } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { tokoTiktok, tokenHidupTiktok, panggil } from '@/lib/tiktok';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Penjelajah endpoint TikTok.
 *
 * Sebelum menulis penyinkron pesanan, nama endpoint dan BENTUK BALASANNYA
 * harus dipastikan lebih dulu — persis seperti pelajaran mahal di Shopee,
 * di mana penarikan retur "berhasil, 0 baris" selama berminggu-minggu
 * karena saringan waktu yang ternyata tidak didukung.
 *
 * Rute ini memanggil kandidat endpoint satu per satu dengan jendela waktu
 * kecil, lalu melaporkan: berhasil atau tidak, kode galat TikTok, dan
 * NAMA-NAMA FIELD yang benar-benar dikirim. Tidak ada yang ditebak.
 */
const KANDIDAT = [
  { nama: 'Daftar toko', path: '/authorization/202309/shops', method: 'GET', cipher: false },
  { nama: 'Cari pesanan', path: '/order/202309/orders/search', method: 'POST',
    params: { page_size: 5 },
    body: () => {
      const kini = Math.floor(Date.now() / 1000);
      return { create_time_ge: kini - 3 * 86400, create_time_lt: kini };
    } },
  { nama: 'Cari produk', path: '/product/202309/products/search', method: 'POST',
    params: { page_size: 5 }, body: () => ({ status: 'ACTIVATE' }) },
  // sort_field WAJIB — tanpa itu TikTok menolak dengan 36009004.
  { nama: 'Laporan keuangan', path: '/finance/202309/statements', method: 'GET',
    params: { page_size: 5, sort_field: 'statement_time' } },
  { nama: 'Pembayaran', path: '/finance/202309/payments', method: 'GET',
    params: { page_size: 5, sort_field: 'create_time' } },
  { nama: 'Transaksi pesanan', path: '/finance/202501/orders/settlements', method: 'GET',
    params: { page_size: 5 } },
  { nama: 'Retur', path: '/return_refund/202309/returns/search', method: 'POST',
    params: { page_size: 5 }, body: () => ({}) },

  /**
   * ── Kandidat 30 Sep 2026: penentu tahap berikutnya ──
   *
   * Tiga hal yang belum bisa dibangun tanpa bukti bentuk balasan:
   *   1. Keuangan TikTok per pesanan — perlu uang cair PER PESANAN (dan
   *      apakah potongan iklan GMV Max ada di dalamnya), bukan cuma total
   *      per statement.
   *   2. Detail pesanan — untuk memastikan nama field paket (packages / id)
   *      dan batas kirim yang sekarang dibaca bertahan di tiktok-sync.
   *   3. Label kirim TikTok — untuk cetak resi dari halaman Pesanan.
   * Semuanya GET, tidak mengubah apa pun di TikTok. Id-nya diambil dari data
   * yang sudah tersimpan; kalau belum ada, kandidatnya dilewati dengan alasan.
   */
  { nama: 'Transaksi per statement', method: 'GET',
    path: (c) => c.statement && `/finance/202309/statements/${c.statement}/statement_transactions`,
    alasanKosong: 'belum ada statement tersimpan untuk toko ini',
    params: { page_size: 5, sort_field: 'order_create_time' } },
  { nama: 'Transaksi per pesanan', method: 'GET',
    path: (c) => c.selesai && `/finance/202309/orders/${c.selesai}/statement_transactions`,
    alasanKosong: 'belum ada pesanan COMPLETED tersimpan' },
  { nama: 'Detail pesanan', method: 'GET', path: '/order/202309/orders',
    params: (c) => (c.kirim ? { ids: c.kirim } : null),
    alasanKosong: 'belum ada pesanan tersimpan' },
  { nama: 'Label kirim — paket AWAITING_SHIPMENT', method: 'GET',
    path: (c) => c.paketBaru && `/fulfillment/202309/packages/${c.paketBaru}/shipping_documents`,
    alasanKosong: 'tidak ada pesanan AWAITING_SHIPMENT yang punya paket_id saat ini',
    params: { document_type: 'SHIPPING_LABEL' } },
  /**
   * Label AWAITING_SHIPMENT ditolak 21042104 "Documents couldn't be printed
   * before shipped. Please check shipping is arranged" — jadi cetak resi
   * TikTok butuh langkah ATUR KIRIM dulu (setara Pack di Shopee). Dua
   * kandidat di bawah hanya MEMBACA: detail paket dan pilihan jadwal serah
   * terima, supaya parameter atur kirim diketahui dari TikTok sendiri,
   * bukan ditebak. Atur kirimnya sendiri tidak diuji di sini karena tidak
   * bisa dibatalkan.
   */
  { nama: 'Detail paket (AWAITING_SHIPMENT)', method: 'GET',
    path: (c) => c.paketBaru && `/fulfillment/202309/packages/${c.paketBaru}`,
    alasanKosong: 'tidak ada pesanan AWAITING_SHIPMENT yang punya paket_id saat ini' },
  { nama: 'Jadwal serah terima paket', method: 'GET',
    path: (c) => c.paketBaru && `/fulfillment/202309/packages/${c.paketBaru}/handover_time_slots`,
    alasanKosong: 'tidak ada pesanan AWAITING_SHIPMENT yang punya paket_id saat ini' },
  { nama: 'Label kirim — paket AWAITING_COLLECTION', method: 'GET',
    path: (c) => c.paketSiap && `/fulfillment/202309/packages/${c.paketSiap}/shipping_documents`,
    alasanKosong: 'tidak ada pesanan AWAITING_COLLECTION saat ini (toko ini biasanya langsung '
      + 'dari AWAITING_SHIPMENT ke IN_TRANSIT)',
    params: { document_type: 'SHIPPING_LABEL' } },
];

/**
 * Nama field saja, bukan isinya — jadi aman dilihat siapa pun dan cukup
 * untuk merancang tabel. Kedalaman bisa dinaikkan lewat ?dalam=3 untuk
 * melihat ke dalam line_items dan payment, tempat harga dan SKU berada.
 */
function bentuk(nilai, sisa) {
  if (Array.isArray(nilai)) {
    return nilai.length ? [`${nilai.length} baris`, bentuk(nilai[0], sisa - 1)] : ['kosong'];
  }
  if (nilai && typeof nilai === 'object') {
    if (sisa <= 0) return Object.keys(nilai);
    return Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k,
      v && typeof v === 'object' ? bentuk(v, sisa - 1) : typeof v]));
  }
  return typeof nilai;
}

export async function GET(req) {
  if (!sesi()) return NextResponse.json({ ok: false, error: 'Belum masuk' }, { status: 401 });
  await ensureSchema();
  const u = new URL(req.url);

  const toko = await tokoTiktok();
  const t = u.searchParams.get('shop_id')
    ? toko.find((x) => x.shop_id === u.searchParams.get('shop_id')) : toko[0];
  if (!t) return NextResponse.json({ ok: false, error: 'Belum ada toko TikTok terhubung' }, { status: 400 });

  const hidup = await tokenHidupTiktok(t.shop_id);
  const saring = u.searchParams.get('path');
  const dalam = Math.min(Math.max(Number(u.searchParams.get('dalam')) || 2, 1), 5);
  const hasil = [];

  // Id contoh untuk kandidat yang jalurnya memuat id.
  const c = {
    statement: (await one(`SELECT statement_id FROM tiktok_statements WHERE shop_id = $1
                            ORDER BY statement_time DESC NULLS LAST LIMIT 1`, [t.shop_id]))?.statement_id,
    selesai: (await one(`SELECT order_id FROM tiktok_orders WHERE shop_id = $1 AND status = 'COMPLETED'
                         ORDER BY update_time DESC NULLS LAST LIMIT 1`, [t.shop_id]))?.order_id,
    kirim: (await one(`SELECT order_id FROM tiktok_orders WHERE shop_id = $1
                       ORDER BY (status = 'AWAITING_COLLECTION') DESC, create_time DESC LIMIT 1`,
                      [t.shop_id]))?.order_id,
    /**
     * Paket untuk uji label — sekarang DUA contoh.
     *
     * Uji 30 Sep membuktikan jalur & parameternya benar: paket IN_TRANSIT
     * ditolak TikTok dengan 21042102 "Documents couldn't be printed after
     * the package has been pickup" — itu penolakan bisnis, bukan jalur
     * salah. Toko ini tidak pernah terlihat di AWAITING_COLLECTION, jadi
     * pertanyaan yang tersisa: bisakah label diambil saat pesanan masih
     * AWAITING_SHIPMENT (belum diatur kirim)? Kalau tidak, cetak resi TikTok
     * butuh langkah "atur kirim" dulu, seperti Pack di Shopee.
     */
    paketBaru: (await one(`SELECT paket_id FROM tiktok_orders WHERE shop_id = $1
                           AND paket_id IS NOT NULL AND status = 'AWAITING_SHIPMENT'
                           ORDER BY create_time DESC LIMIT 1`, [t.shop_id]))?.paket_id,
    paketSiap: (await one(`SELECT paket_id FROM tiktok_orders WHERE shop_id = $1
                           AND paket_id IS NOT NULL AND status = 'AWAITING_COLLECTION'
                           ORDER BY create_time DESC LIMIT 1`, [t.shop_id]))?.paket_id,
  };

  for (const k of KANDIDAT) {
    const path = typeof k.path === 'function' ? k.path(c) : k.path;
    const params = typeof k.params === 'function' ? k.params(c) : (k.params || {});
    const tampil = { nama: k.nama, method: k.method, path: path || '(butuh id contoh)' };
    if (saring && path !== saring && k.nama !== saring) continue;
    if (!path || params === null) {
      hasil.push({ ...tampil, ok: false, dilewati: true, galat: k.alasanKosong || 'dilewati' });
      continue;
    }
    try {
      const json = await panggil(path, {
        method: k.method, token: hidup.access_token,
        shopCipher: k.cipher === false ? null : t.shop_cipher,
        params, body: k.body ? k.body() : null,
      });
      hasil.push({ ...tampil, params, ok: true, bentuk: bentuk(json.data, dalam),
                   });
    } catch (e) {
      hasil.push({ ...tampil, params, ok: false, kode: e.kode || null, galat: e.message,
                   });
    }
  }

  return NextResponse.json({
    ok: true, toko: t.shop_name, shop_id: t.shop_id,
    catatan: 'Untuk endpoint yang ok:false, kode galat TikTok menunjukkan sebabnya — 105002 biasanya '
           + 'jalur/nama salah, 36004xxx soal otorisasi, dan pesan "shop not authorized" berarti '
           + 'shop_cipher belum ikut atau scope belum aktif.',
    hasil,
  });
}
