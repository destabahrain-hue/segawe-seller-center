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

  // ── Iklan per PRODUK (untuk biaya iklan per SKU) ──
  // Parameter & bentuk balasan disalin dari View API Details, bukan tebakan.
  //
  // adsCampaignList     : params ad_type (all/auto/manual), offset, limit
  //                       → response.campaign_list[] { ad_type, campaign_id }
  //                       + has_next_page. Cuma ID, TIDAK ada item_id.
  // adsCampaignSetting  : info_type_list WAJIB ANGKA '1,2,3,4' (bukan nama —
  //                       ini yang dulu bikin tabel Campaign strip semua di
  //                       Ad Storm). campaign_id_list maks 100 per panggilan.
  //                       Di sinilah item_id iklan produk berada.
  // adsCampaignDaily    : start_date, end_date (DD-MM-YYYY), campaign_id_list
  //                       (koma, maks 100) → campaign_list[].metrics_list[]
  //                       { date, expense, ... }. Per HARI, tapi tanpa item_id.
  // adsGmsItem          : POST. start_date & end_date wajib (maks rentang 3
  //                       bulan, paling awal 6 bulan lalu), campaign_id
  //                       opsional, offset, limit (maks 100).
  //                       → result_list[] { item_id, report { expense, ... } }
  //                       SATU-SATUNYA yang punya item_id + expense sebaris,
  //                       tapi TANPA kolom date (total sepanjang rentang).
  adsCampaignList:    { path: '/api/v2/ads/get_product_level_campaign_id_list',     method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  adsCampaignSetting: { path: '/api/v2/ads/get_product_level_campaign_setting_info', method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  adsCampaignDaily:   { path: '/api/v2/ads/get_product_campaign_daily_performance',  method: 'GET',  auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  adsGmsItem:         { path: '/api/v2/ads/get_gms_item_performance',                method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  // get_gms_campaign_performance: satu-satunya kandidat untuk MENDAFTAR
  // campaign GMV Max. Balasannya (dari catatan Ad Storm) cuma campaign_id +
  // objek "report" berisi angka performa — tanpa nama, budget, atau status.
  // Yang belum pernah diuji: apakah dia mau dipanggil TANPA campaign_id, dan
  // kalau ya apakah mengembalikan LEBIH DARI SATU campaign.
  adsGmsCampaign:     { path: '/api/v2/ads/get_gms_campaign_performance',            method: 'POST', auth: 'shop', status: 'ADA-BELUM-DIUJI' },

  // ── Purna jual / retur ────────────────────────────────────
  // Parameter & bentuk balasan diambil dari View API Details, bukan tebakan.
  // get_return_list: page_no, page_size, create_time_from/to,
  // update_time_from/to, status, negotiation_status, seller_proof_status,
  // seller_compensation_status → response.more + response.return[]
  returList:    { path: '/api/v2/returns/get_return_list',   method: 'GET', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  returDetail:  { path: '/api/v2/returns/get_return_detail', method: 'GET', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
  returJejak:   { path: '/api/v2/returns/get_reverse_tracking_info', method: 'GET', auth: 'shop', status: 'ADA-BELUM-DIUJI' },
};

// Batas panggilan: jeda antar permintaan ke Shopee (milidetik).
// Shopee punya rate limit bertingkat; untuk operasi massal multi-toko
// jangan pernah kirim semua sekaligus.
export const JEDA_MS = 350;

// Berapa pesanan per panggilan get_order_detail.
export const ORDER_DETAIL_BATCH = 50;
