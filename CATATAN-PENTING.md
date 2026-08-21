# Yang perlu kamu lakukan setelah menerima paket ini

Urutannya penting. Jangan lompat.

## 1. Sebelum deploy — periksa endpoint

Buka `lib/endpoints.js`. Ada dua penanda:

- `TERKONFIRMASI` — sudah terbukti jalan di Ad Storm, tidak perlu diapa-apakan.
- `PERIKSA` — perlu dicocokkan di API Test Tool.

Yang bertanda PERIKSA:

| Yang dipakai untuk | Path tebakan |
|---|---|
| daftar pesanan | `/api/v2/order/get_order_list` |
| detail pesanan | `/api/v2/order/get_order_detail` |
| rincian dana diterima | `/api/v2/payment/get_escrow_detail` |
| daftar produk | `/api/v2/product/get_item_list` |
| ubah harga | `/api/v2/product/update_price` |
| ubah stok | `/api/v2/product/update_stock` |
| belanja iklan harian | `/api/v2/ads/get_all_cpc_ads_daily_performance` |

Cara mengecek: Open Platform Console → API Test Tool → Partner ID **milik PT Segawe Jaya Mulia** (bukan 1239240 punya Numedix) →
pilih kategori → pilih nama API → **View API Details**.
Cocokkan path dan nama parameter. Kalau beda, perbaiki di `lib/endpoints.js` saja.

Yang paling menentukan fase 1: **order_list**, **order_detail**, dan **escrow_detail**.
Tiga itu dulu. Sisanya boleh belakangan.

## 2. Urutan menghidupkan aplikasi

1. Repo GitHub → 2. Railway + Postgres → 3. Variables → 4. Domain port 8080 →
5. Daftarkan redirect di Shopee → 6. Hubungkan toko → 7. Cron

Rinciannya di `README.md`.

## 3. Setelah toko pertama terhubung

Aplikasi belum tahu HPP-mu, jadi laba masih terlihat terlalu tinggi. Yang harus diisi:

1. **Master SKU** → buat master SKU untuk tiap produk (kode + nama).
2. SKU dari tiap toko yang penulisannya sama persis akan **tertaut sendiri**.
   Sisanya muncul di tabel "SKU toko belum tertaut" — tautkan manual, sekali saja.
3. Isi **HPP** langsung di tabel Master SKU. Cukup sekali, berlaku untuk semua toko.
4. Untuk paket bundling: ubah tipe jadi **paket**, lalu **Atur isi paket**.
   HPP paket dihitung otomatis dari komponennya.
5. **Gudang** → **Catat stok masuk**. Harga beli yang kamu isi di sini otomatis
   menjadi HPP berlaku, jadi ke depan cukup catat barang datang.

Dashboard akan memberi peringatan selama masih ada SKU yang belum tertaut.

## 4. Yang belum dikerjakan (sengaja)

- **Produk massal** — halaman sudah ada, antrean sudah siap, tapi belum dihidupkan.
  Ini fase 3, dikerjakan setelah keuangan dan gudang terbukti jalan.
- **Belanja iklan** — tabel `ad_spend` sudah ada tapi belum ada penariknya.
  Sampai diisi, kolom iklan menampilkan nol dan laba jadi sedikit terlalu tinggi.
- **Cetak label & sinkron resi** — fase 4, ini yang menentukan kapan kamu
  bisa berhenti berlangganan BigSeller.
