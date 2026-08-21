import { rp } from './fmt';

/**
 * ── Katalog kolom ekspor pesanan ──
 *
 * Daftarnya mengikuti ekspor BigSeller (100 kolom, diambil dari berkas
 * ekspor asli — bukan dibaca dari tangkapan layar), supaya berkas hasil
 * ekspor NSC bisa langsung menggantikannya di alur kerja yang sudah ada.
 *
 * Tiap kolom punya penanda `ada`:
 *
 *   true  → datanya memang kita punya dan terisi
 *   false → BigSeller punya, kita TIDAK. Kolomnya tetap tersedia supaya
 *           susunan berkas bisa persis sama kalau memang dibutuhkan, tapi
 *           isinya kosong dan di layar diberi tanda.
 *
 * Kolom kosong sengaja TIDAK disembunyikan diam-diam. Orang yang menyusun
 * template berhak tahu bahwa "Nomor Rak" akan selalu kosong sebelum ia
 * memasukkannya ke laporan mingguan, bukan menemukannya sendiri nanti.
 *
 * `kel` = kelompok, dipakai untuk mengelompokkan pilihan di halaman
 * penyusun template.
 */

const wkt = (t) => (t
  ? new Date(t).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).replace(/\./g, ':')
  : '');

const angka = (v) => (v === null || v === undefined || v === '' ? '' : Number(v) || 0);

const tahapDari = (o) => o.tahap || '';

export const KATALOG = [
  // ── Identitas pesanan ──
  ['order_sn',        'Nomor Pesanan',            'Pesanan', true,  (o) => o.order_sn],
  ['package_number',  'Nomor Paket',              'Pesanan', true,  (o) => o.package_number],
  ['jenis_pesanan',   'Jenis Pesanan',            'Pesanan', true,  (o) => o.jenis_pesanan],
  ['penandaan',       'Penandaan Pesanan',        'Pesanan', false, () => ''],
  ['jenis_paket',     'Jenis Paket',              'Pesanan', false, () => ''],
  ['paket_utama',     'Nomor Paket Utama',        'Pesanan', false, () => ''],
  ['invoice',         'Nomor Invoice',            'Pesanan', false, () => ''],
  ['tahap',           'Status Pesanan',           'Pesanan', true,  tahapDari],
  ['status_mp',       'Status Marketplace',       'Pesanan', true,  (o) => o.status],
  ['marketplace',     'Marketplace',              'Pesanan', true,  () => 'Shopee'],
  ['toko',            'Toko Marketplace',         'Pesanan', true,  (o) => o.shop_name || `Toko ${o.shop_id}`],
  ['toko_alias',      'Nama Panggilan Toko',      'Pesanan', false, () => ''],
  ['order_sn_mp',     'Nomor Pesanan Marketplace','Pesanan', true,  (o) => o.order_sn],
  ['tidak_normal',    'Pesanan Tidak Normal',     'Pesanan', false, () => ''],

  // ── Pembeli & pengiriman ──
  ['penjual',         'Nama Penjual',             'Pembeli', true,  (o) => o.shop_name || ''],
  ['pembeli',         'Nama Pembeli',             'Pembeli', true,  (o) => o.buyer_username],
  ['no_pelanggan',    'Nomor Pelanggan',          'Pembeli', false, () => ''],
  ['nama_pelanggan',  'Nama Pelanggan',           'Pembeli', true,  (o) => o.recipient_name],
  ['penerima',        'Nama Penerima',            'Pembeli', true,  (o) => o.recipient_name],
  ['telepon',         'Nomor Telepon',            'Pembeli', true,  (o) => o.phone],
  ['kodepos',         'Kode Pos',                 'Pembeli', true,  (o) => o.zipcode],
  ['negara',          'Negara',                   'Pembeli', true,  () => 'Indonesia'],
  ['provinsi',        'Provinsi',                 'Pembeli', true,  (o) => o.region],
  ['kota',            'Kabupaten/Kota',           'Pembeli', true,  (o) => o.city],
  ['kecamatan',       'Kecamatan',                'Pembeli', true,  (o) => o.district],
  ['kelurahan',       'Kelurahan',                'Pembeli', false, () => ''],
  ['alamat',          'Alamat Lengkap',           'Pembeli', true,  (o) => o.address],
  ['pesan_pembeli',   'Pesan dari Pembeli',       'Pembeli', true,  (o) => o.buyer_message],

  // ── Barang ──
  ['sku',             'SKU',                      'Barang',  true,  (o) => o.sku],
  ['product_id',      'Product ID',               'Barang',  true,  (o) => o.item_id],
  ['nama_produk',     'Nama Produk',              'Barang',  true,  (o) => o.item_name],
  ['variasi',         'Nama Variasi',             'Barang',  true,  (o) => o.model_sku],
  ['kategori1',       'Kategori Tingkat Pertama', 'Barang',  false, () => ''],
  ['kategori2',       'Kategori Tingkat Kedua',   'Barang',  false, () => ''],
  ['kategori3',       'Kategori Tingkat Ketiga',  'Barang',  false, () => ''],
  ['qty',             'Jumlah',                   'Barang',  true,  (o) => angka(o.qty)],
  ['harga',           'Harga Satuan',             'Barang',  true,  (o) => angka(o.price)],
  ['subtotal',        'Subtotal Produk',          'Barang',  true,  (o) => (Number(o.qty) || 0) * (Number(o.price) || 0)],
  ['harga_awal',      'Harga Awal Produk',        'Barang',  false, () => ''],
  ['master_sku',      'SKU Gudang',               'Barang',  true,  (o) => o.master_code],
  ['master_nama',     'Nama SKU Gudang',          'Barang',  true,  (o) => o.master_name],
  ['satuan',          'Satuan Dasar',             'Barang',  true,  (o) => o.master_unit],
  ['no_seri',         'Nomor Seri',               'Barang',  false, () => ''],
  ['gambar',          'Tautan Gambar',            'Barang',  true,  (o) => o.image_url],
  ['hpp',             'Modal SKU Gudang',         'Barang',  true,  (o) => angka(o.hpp)],
  ['hpp_subtotal',    'Modal Subtotal',           'Barang',  true,  (o) => (Number(o.qty) || 0) * (Number(o.hpp) || 0)],
  ['harga_referensi', 'Harga Referensi',          'Barang',  false, () => ''],
  ['berat_produk',    'Berat Produk',             'Barang',  false, () => ''],
  ['panjang',         'Panjang',                  'Barang',  false, () => ''],
  ['lebar',           'Lebar',                    'Barang',  false, () => ''],
  ['tinggi',          'Tinggi',                   'Barang',  false, () => ''],
  ['rak',             'Nomor Rak',                'Barang',  false, () => ''],
  ['berat_paket',     'Berat Paket (g)',          'Barang',  false, () => ''],

  // ── Gudang & petugas ──
  ['pemeriksa',       'Pemeriksa Paket',          'Gudang',  false, () => ''],
  ['sales',           'Staf Penjualan',           'Gudang',  false, () => ''],
  ['stok_kurang',     'Sudah Kurangi Stok',       'Gudang',  true,  (o) => (o.stock_applied ? 'Ya' : 'Belum')],
  ['stok_tambah',     'Sudah Tambah Stok',        'Gudang',  false, () => ''],
  ['gudang_asal',     'Gudang Asal',              'Gudang',  false, () => ''],
  ['alokasi',         'Dialokasikan/Kurangi',     'Gudang',  false, () => ''],
  ['disisihkan',      'Disisihkan',               'Gudang',  true,  (o) => (o.disisihkan_at ? 'Ya' : '')],
  ['disisihkan_ket',  'Alasan Disisihkan',        'Gudang',  true,  (o) => o.disisihkan_alasan],

  // ── Pengiriman ──
  ['kurir_pembeli',   'Jasa Kirim Dipilih Pembeli','Kirim',  true,  (o) => o.carrier],
  ['kurir',           'Nama Jasa Kirim',          'Kirim',   true,  (o) => o.carrier],
  ['metode_kirim',    'Metode Pengiriman',        'Kirim',   false, () => ''],
  ['resi',            'Nomor Resi',               'Kirim',   true,  (o) => o.tracking_no],
  ['kode_jemput',     'Kode Pengambilan',         'Kirim',   true,  (o) => o.pickup_code],
  ['status_kirim',    'Status Pengiriman',        'Kirim',   true,  (o) => o.tracking_status],
  ['cetak_ke',        'Jumlah Cetak Resi',        'Kirim',   true,  (o) => angka(o.print_count)],

  // ── Uang ──
  ['ongkir',          'Ongkos Kirim',             'Uang',    false, () => ''],
  ['ongkir_penjual',  'Ongkir Dibayar Penjual',   'Uang',    false, () => ''],
  ['diskon_ongkir_p', 'Diskon Ongkir Penjual',    'Uang',    false, () => ''],
  ['diskon_ongkir_mp','Diskon Ongkir Marketplace','Uang',    false, () => ''],
  ['total',           'Total Pesanan',            'Uang',    true,  (o) => angka(o.total_amount)],
  ['metode_bayar',    'Metode Pembayaran',        'Uang',    true,  (o) => o.payment_method],
  ['biaya_kelola',    'Biaya Pengelolaan',        'Uang',    false, () => ''],
  ['biaya_transaksi', 'Biaya Transaksi',          'Uang',    false, () => ''],
  ['diskon_penjual',  'Diskon Penjual',           'Uang',    true,  (o) => angka(o.seller_discount)],
  ['diskon_mp',       'Diskon Marketplace',       'Uang',    true,  (o) => angka(o.shopee_subsidy)],
  ['voucher',         'Voucher',                  'Uang',    false, () => ''],
  ['voucher_toko',    'Voucher Toko',             'Uang',    false, () => ''],
  ['mata_uang',       'Mata Uang',                'Uang',    true,  () => 'IDR'],
  ['komisi',          'Komisi',                   'Uang',    true,  (o) => angka(o.commission_fee)],
  ['biaya_layanan',   'Biaya Layanan',            'Uang',    true,  (o) => angka(o.service_fee)],
  ['ppn',             'PPN',                      'Uang',    false, () => ''],
  ['bruto',           'Dana Kotor',               'Uang',    true,  (o) => angka(o.gross_amount)],
  ['escrow',          'Dana Diterima',            'Uang',    true,  (o) => angka(o.escrow_amount)],
  ['dana_masuk',      'Tanggal Dana Masuk',       'Uang',    true,  (o) => wkt(o.release_at)],
  ['status_bayar',    'Status Pembayaran Periode','Uang',    true,  (o) => (o.release_at ? 'Sudah cair' : 'Belum cair')],
  ['saluran_bayar',   'Saluran Pembayaran',       'Uang',    false, () => ''],

  // ── Waktu ──
  ['w_dibuat',        'Waktu Pesanan Dibuat',     'Waktu',   true,  (o) => wkt(o.created_time)],
  ['w_dibayar',       'Waktu Pesanan Dibayar',    'Waktu',   true,  (o) => wkt(o.paid_at)],
  ['w_batas',         'Waktu Kedaluwarsa',        'Waktu',   true,  (o) => wkt(o.ship_by_date)],
  ['w_proses',        'Waktu Proses',             'Waktu',   true,  (o) => wkt(o.ship_arranged_at)],
  ['w_cetak',         'Waktu Cetak',              'Waktu',   true,  (o) => wkt(o.printed_at)],
  ['w_dikemas',       'Waktu Dikemas',            'Waktu',   true,  (o) => wkt(o.packed_at)],
  ['w_dikirim',       'Waktu Pesanan Dikirim',    'Waktu',   true,  (o) => wkt(o.ship_time)],
  ['w_selesai',       'Waktu Selesai',            'Waktu',   true,  (o) => wkt(o.completed_at)],
  ['w_batal',         'Waktu Pembatalan',         'Waktu',   true,  (o) => wkt(o.cancelled_at)],

  // ── Pembatalan & catatan ──
  ['alasan_batal',    'Alasan Pembatalan',        'Lainnya', true,  (o) => o.cancel_reason],
  ['pembatal',        'Yang Membatalkan',         'Lainnya', true,  (o) => o.cancel_by],
  ['status_sebelum',  'Status Sebelum Dibatalkan','Lainnya', false, () => ''],
  ['catatan_penjual', 'Catatan Penjual',          'Lainnya', false, () => ''],
  ['catatan_cs',      'Catatan untuk CS',         'Lainnya', false, () => ''],
  ['catatan_ambil',   'Catatan Pengambilan',      'Lainnya', false, () => ''],
  ['pemasok',         'Nama Pemasok',             'Lainnya', false, () => ''],
  ['kode_pemasok',    'Kode Pemasok',             'Lainnya', false, () => ''],
];

export const petaKolom = new Map(KATALOG.map((k) => [k[0], k]));

export const KELOMPOK = [...new Set(KATALOG.map((k) => k[2]))];

/** Kolom yang datanya memang ada — dipakai sebagai template bawaan. */
export const KUNCI_TERISI = KATALOG.filter((k) => k[3]).map((k) => k[0]);

/**
 * Template bawaan.
 *
 * "Lengkap (gaya BigSeller)" sengaja memuat SEMUA kolom termasuk yang
 * kosong, supaya berkasnya bisa menggantikan ekspor BigSeller apa adanya
 * di rumus atau makro yang sudah terlanjur dibuat orang. Sisanya hanya
 * memuat kolom yang benar-benar terisi.
 */
export const TEMPLATE_BAWAAN = [
  { kode: 'ringkas', nama: 'Ringkas', kunci: [
    'order_sn', 'jenis_pesanan', 'tahap', 'toko', 'sku', 'master_sku', 'nama_produk', 'qty',
    'harga', 'subtotal', 'total', 'kurir', 'resi', 'w_dibuat', 'w_dikirim',
  ] },
  { kode: 'sortir', nama: 'Sortir gudang (per SKU)', kunci: [
    'sku', 'master_sku', 'nama_produk', 'qty', 'jenis_pesanan', 'order_sn', 'toko', 'kurir',
    'resi', 'rak', 'penerima', 'kota', 'w_batas',
  ] },
  { kode: 'keuangan', nama: 'Keuangan', kunci: [
    'order_sn', 'toko', 'tahap', 'sku', 'master_sku', 'qty', 'harga', 'subtotal',
    'hpp', 'hpp_subtotal', 'total', 'komisi', 'biaya_layanan', 'escrow',
    'status_bayar', 'dana_masuk', 'w_dibuat', 'w_dibayar',
  ] },
  { kode: 'lengkap', nama: 'Lengkap (gaya BigSeller)', kunci: KATALOG.map((k) => k[0]) },
];

/** Bersihkan daftar kunci dari layar: buang yang tak dikenal, buang kembar. */
export function kunciSah(daftar) {
  const keluar = [];
  for (const k of Array.isArray(daftar) ? daftar : []) {
    const s = String(k).trim();
    if (petaKolom.has(s) && !keluar.includes(s)) keluar.push(s);
  }
  return keluar;
}
