// ══════════════════════════════════════════════════════════════════
//  SATU-SATUNYA tempat path & parameter Shopee ditulis.
//  Kalau ada endpoint yang salah, cukup perbaiki di file ini —
//  tidak perlu menyentuh file lain.
//
//  Status:
//    TERKONFIRMASI = sudah terbukti jalan di proyek Ad Storm
//    PERIKSA       = tebakan wajar, WAJIB dicek di API Test Tool
//                    (Open Platform Console → API Test Tool →
//                     pilih Partner ID 1239240 → View API Details)
// ══════════════════════════════════════════════════════════════════

export const EP = {
  // ── Otorisasi ─────────────────────────────────────────────
  authPartner:  { path: '/api/v2/shop/auth_partner',    method: 'GET',  auth: 'public', status: 'TERKONFIRMASI' },
  tokenGet:     { path: '/api/v2/auth/token/get',        method: 'POST', auth: 'public', status: 'TERKONFIRMASI' },
  tokenRefresh: { path: '/api/v2/auth/access_token/get', method: 'POST', auth: 'public', status: 'TERKONFIRMASI' },
  // ── Tanggapi permintaan batal dari pembeli ──
  // TIDAK BISA DIBATALKAN. Menyetujui = pesanan asli pembeli benar-benar batal.
  tanggapiBatal: { path: '/api/v2/order/handle_buyer_cancellation', method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  cancelAuth:   { path: '/api/v2/shop/cancel_auth_partner', method: 'GET', auth: 'public', status: 'PERIKSA' },

  // ── Toko ──────────────────────────────────────────────────
  shopInfo:     { path: '/api/v2/shop/get_shop_info',    method: 'GET',  auth: 'shop',   status: 'TERKONFIRMASI' },

  // ── Pesanan ───────────────────────────────────────────────
  orderList:    { path: '/api/v2/order/get_order_list',   method: 'GET',  auth: 'shop',  status: 'PERIKSA' },
  orderDetail:  { path: '/api/v2/order/get_order_detail', method: 'GET',  auth: 'shop',  status: 'PERIKSA' },

  // ── Dana diterima ─────────────────────────────────────────
  escrowDetail: { path: '/api/v2/payment/get_escrow_detail', method: 'GET', auth: 'shop', status: 'PERIKSA' },
  // Satu-satunya sumber TANGGAL PENCAIRAN. get_escrow_detail tidak mengirim
  // field waktu sama sekali untuk akun ini — sudah dibuktikan lewat
  // /api/diagnosa-escrow, penelusur stempel waktunya pulang dengan tangan
  // kosong. Endpoint ini justru mencari BERDASARKAN rentang pencairan.
  // Parameter: release_time_from, release_time_to, page_size, page_no.
  // Balasan: response.escrow_list[] { order_sn, payout_amount,
  // escrow_release_time } + response.more untuk halaman berikutnya.
  escrowList:   { path: '/api/v2/payment/get_escrow_list',   method: 'GET', auth: 'shop', status: 'TERKONFIRMASI' },

  // ── Produk ────────────────────────────────────────────────
  itemList:     { path: '/api/v2/product/get_item_list',      method: 'GET',  auth: 'shop', status: 'PERIKSA' },
  itemBaseInfo: { path: '/api/v2/product/get_item_base_info', method: 'GET',  auth: 'shop', status: 'PERIKSA' },
  modelList:    { path: '/api/v2/product/get_model_list',     method: 'GET',  auth: 'shop', status: 'PERIKSA' },
  updatePrice:  { path: '/api/v2/product/update_price',       method: 'POST', auth: 'shop', status: 'PERIKSA' },
  updateStock:  { path: '/api/v2/product/update_stock',       method: 'POST', auth: 'shop', status: 'PERIKSA' },

  // ── Salin listing antar toko (semuanya TERKONFIRMASI ADA di app 1239240) ──
  addItem:      { path: '/api/v2/product/add_item',            method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  initTier:     { path: '/api/v2/product/init_tier_variation', method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  uploadImage:  { path: '/api/v2/media_space/upload_image',    method: 'POST', auth: 'public', status: 'ADA-BELUM-DIUJI', multipart: true },
  channelList:  { path: '/api/v2/logistics/get_channel_list',  method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // ── Pelacakan paket — hanya MEMBACA, tidak mengubah apa pun di Shopee ──
  trackingNumber: { path: '/api/v2/logistics/get_tracking_number', method: 'GET', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  trackingInfo:   { path: '/api/v2/logistics/get_tracking_info',   method: 'GET', auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // ── Cetak resi. Membuat dokumen TIDAK mengirim pesanan — ia hanya
  //    menyiapkan label untuk pesanan yang pengirimannya sudah diatur. ──
  docParam:    { path: '/api/v2/logistics/get_shipping_document_parameter', method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  docBuat:     { path: '/api/v2/logistics/create_shipping_document',        method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  docHasil:    { path: '/api/v2/logistics/get_shipping_document_result',    method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  docUnduh:    { path: '/api/v2/logistics/download_shipping_document',      method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // Varian "job" — jalur massal/asinkron. Kemungkinan inilah yang dipakai
  // alat lain untuk mencetak banyak label sekaligus.
  docJobBuat:  { path: '/api/v2/logistics/create_shipping_document_job',    method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  docJobCek:   { path: '/api/v2/logistics/get_shipping_document_job_status', method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  docJobUnduh: { path: '/api/v2/logistics/download_shipping_document_job',  method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  docKeLabel:  { path: '/api/v2/logistics/download_to_label',               method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // ── Atur pengiriman. TIDAK BISA DIBATALKAN: begitu berhasil, pesanan
  //    resmi diatur pengirimannya di Shopee dan resinya terbit. ──
  kirimParam:  { path: '/api/v2/logistics/get_shipping_parameter', method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  kirimAtur:   { path: '/api/v2/logistics/ship_order',             method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  alamatList:  { path: '/api/v2/logistics/get_address_list',       method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // ── Boost (naikkan produk) — TERKONFIRMASI ADA di app 1239240 ──
  boostItem:    { path: '/api/v2/product/boost_item',        method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  boostedList:  { path: '/api/v2/product/get_boosted_list',  method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // ── Iklan ─────────────────────────────────────────────────
  adsDaily:     { path: '/api/v2/ads/get_all_cpc_ads_daily_performance', method: 'GET', auth: 'shop', status: 'PERIKSA' },
};

// Batas panggilan: jeda antar permintaan ke Shopee (milidetik).
// Shopee punya rate limit bertingkat; untuk operasi massal multi-toko
// jangan pernah kirim semua sekaligus.
export const JEDA_MS = 350;

// Berapa pesanan per panggilan get_order_detail.
export const ORDER_DETAIL_BATCH = 50;
