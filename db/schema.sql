-- Skema Segawe Seller Center. Aman dijalankan berulang kali.

CREATE TABLE IF NOT EXISTS shops (
  shop_id            BIGINT PRIMARY KEY,
  shop_name          TEXT,
  platform           TEXT NOT NULL DEFAULT 'shopee',
  access_token       TEXT,
  refresh_token      TEXT,
  expires_at         TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'active',
  last_error         TEXT,
  last_sync_at       TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Master SKU: pusat HPP, penautan, dan komposisi bundling ──
CREATE TABLE IF NOT EXISTS master_sku (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'tunggal',   -- tunggal | paket
  unit        TEXT DEFAULT 'pcs',
  reorder_at  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS master_sku_hpp (
  id            BIGSERIAL PRIMARY KEY,
  master_sku_id BIGINT NOT NULL REFERENCES master_sku(id) ON DELETE CASCADE,
  hpp           NUMERIC(14,2) NOT NULL,
  effective_from DATE NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (master_sku_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_hpp_lookup ON master_sku_hpp (master_sku_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS master_sku_component (
  parent_id BIGINT NOT NULL REFERENCES master_sku(id) ON DELETE CASCADE,
  child_id  BIGINT NOT NULL REFERENCES master_sku(id) ON DELETE RESTRICT,
  qty       INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (parent_id, child_id)
);

-- SKU toko -> master SKU
CREATE TABLE IF NOT EXISTS sku_mapping (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       BIGINT REFERENCES shops(shop_id) ON DELETE CASCADE,
  shop_sku      TEXT NOT NULL,
  master_sku_id BIGINT REFERENCES master_sku(id) ON DELETE SET NULL,
  auto_linked   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (shop_id, shop_sku)
);

-- ── Produk (salinan dari Shopee) ──
CREATE TABLE IF NOT EXISTS products (
  id           BIGSERIAL PRIMARY KEY,
  shop_id      BIGINT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL,
  name         TEXT,
  item_sku     TEXT,
  status       TEXT,
  image_url    TEXT,
  category_id  BIGINT,
  synced_at    TIMESTAMPTZ,
  UNIQUE (shop_id, item_id)
);

CREATE TABLE IF NOT EXISTS product_models (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  model_id    BIGINT NOT NULL,
  model_name  TEXT,
  model_sku   TEXT,
  price       NUMERIC(14,2),
  stock       INTEGER,
  UNIQUE (product_id, model_id)
);

-- ── Pesanan ──
CREATE TABLE IF NOT EXISTS orders (
  id             BIGSERIAL PRIMARY KEY,
  shop_id        BIGINT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
  order_sn       TEXT NOT NULL,
  status         TEXT,
  buyer_username TEXT,
  region         TEXT,
  carrier        TEXT,
  tracking_no    TEXT,
  total_amount   NUMERIC(14,2) DEFAULT 0,
  created_time   TIMESTAMPTZ,
  ship_time      TIMESTAMPTZ,          -- dipakai untuk potong stok gudang
  stock_applied  BOOLEAN NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, order_sn)
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_time DESC);
CREATE INDEX IF NOT EXISTS idx_orders_ship    ON orders (ship_time DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id        BIGSERIAL PRIMARY KEY,
  order_id  BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id   BIGINT,
  model_id  BIGINT,
  item_name TEXT,
  item_sku  TEXT,
  model_sku TEXT,
  qty       INTEGER NOT NULL DEFAULT 1,
  price     NUMERIC(14,2) DEFAULT 0,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- Rincian dana yang benar-benar diterima (escrow). Lambat keluar,
-- jadi laba harian sebelum ini tersedia bersifat PERKIRAAN.
CREATE TABLE IF NOT EXISTS order_escrow (
  order_id        BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  gross_amount    NUMERIC(14,2) DEFAULT 0,
  buyer_paid      NUMERIC(14,2) DEFAULT 0,
  commission_fee  NUMERIC(14,2) DEFAULT 0,
  service_fee     NUMERIC(14,2) DEFAULT 0,
  seller_discount NUMERIC(14,2) DEFAULT 0,
  shopee_subsidy  NUMERIC(14,2) DEFAULT 0,
  escrow_amount   NUMERIC(14,2) DEFAULT 0,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Gudang: buku besar stok fisik (tidak disinkronkan ke Shopee) ──
CREATE TABLE IF NOT EXISTS stock_moves (
  id            BIGSERIAL PRIMARY KEY,
  master_sku_id BIGINT NOT NULL REFERENCES master_sku(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out','adjust')),
  qty           INTEGER NOT NULL,
  unit_cost     NUMERIC(14,2),          -- harga beli: sumber HPP
  ref_type      TEXT,                   -- 'order' | 'manual' | 'opname'
  ref_id        TEXT,
  note          TEXT,
  moved_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moves_sku ON stock_moves (master_sku_id, moved_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_moves_order_unique
  ON stock_moves (ref_type, ref_id, master_sku_id) WHERE ref_type = 'order';

-- ── Biaya iklan harian per toko ──
CREATE TABLE IF NOT EXISTS ad_spend (
  shop_id  BIGINT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  expense  NUMERIC(14,2) NOT NULL DEFAULT 0,
  gmv      NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, day)
);

-- ── Antrean tugas ──
CREATE TABLE IF NOT EXISTS jobs (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  shop_id      BIGINT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  total_steps  INTEGER NOT NULL DEFAULT 1,
  done_steps   INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jobs_pick ON jobs (status, run_after);

CREATE TABLE IF NOT EXISTS activity_log (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT,
  shop_id    BIGINT,
  message    TEXT,
  ok         BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Tambahan untuk halaman Pesanan (aman dijalankan berulang) ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_by_date   TIMESTAMPTZ;  -- batas waktu kirim
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS printed_at     TIMESTAMPTZ;  -- resi dicetak
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_at      TIMESTAMPTZ;  -- selesai dikemas
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS city           TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS district       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS zipcode        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_message  TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_shipby ON orders (ship_by_date)
  WHERE ship_by_date IS NOT NULL;

-- ── Boost otomatis ──
CREATE TABLE IF NOT EXISTS boost_setting (
  shop_id   BIGINT PRIMARY KEY REFERENCES shops(shop_id) ON DELETE CASCADE,
  otomatis  BOOLEAN NOT NULL DEFAULT false,
  slot      INTEGER NOT NULL DEFAULT 5,
  last_run  TIMESTAMPTZ,
  last_note TEXT
);

CREATE TABLE IF NOT EXISTS boost_pool (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       BIGINT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL,
  aktif         BOOLEAN NOT NULL DEFAULT true,
  last_boost_at TIMESTAMPTZ,
  boost_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (shop_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_boost_giliran ON boost_pool (shop_id, aktif, last_boost_at NULLS FIRST);

-- ── Pengguna & peran ──
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  nama          TEXT NOT NULL,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  peran         TEXT NOT NULL DEFAULT 'gudang',
  aktif         BOOLEAN NOT NULL DEFAULT true,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));

-- ── Penjadwal internal (kunci agar tidak dobel jalan) ──
CREATE TABLE IF NOT EXISTS jadwal (
  nama     TEXT PRIMARY KEY,
  last_run TIMESTAMPTZ,
  last_note TEXT
);

-- ── Pelacakan paket (Tahap 1 modul Logistics) ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_at     TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_info   JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_kurir ON orders (carrier) WHERE carrier IS NOT NULL;

-- Nomor paket. Wajib diikutkan saat meminta dokumen resi untuk pesanan
-- yang punya paket; tanpa ini Shopee membalas "tracking number is invalid".
ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_number TEXT;

-- Berapa kali label pesanan ini pernah dicetak.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_count INTEGER NOT NULL DEFAULT 0;

-- Kapan pengiriman diatur ke Shopee (ship_order berhasil). Inilah gerbang
-- keluar dari tab "Pesanan baru" — bukan lagi penanda resi dicetak.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_arranged_at TIMESTAMPTZ;

-- Kapan dana pesanan dilepas Shopee. Ini dasar periode laporan keuangan —
-- laporan berisi pesanan yang dananya CAIR pada periode itu, bukan yang
-- dipesan, sama seperti metodologi laporan bulanan.
ALTER TABLE order_escrow ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_escrow_release ON order_escrow (release_at)
  WHERE release_at IS NOT NULL;

-- ── Peran yang bisa dibuat sendiri ──
CREATE TABLE IF NOT EXISTS roles (
  id         BIGSERIAL PRIMARY KEY,
  nama       TEXT NOT NULL,
  jelas      TEXT,
  rute       TEXT[] NOT NULL DEFAULT '{}',
  uang       BOOLEAN NOT NULL DEFAULT false,
  kelola     BOOLEAN NOT NULL DEFAULT false,
  bawaan     BOOLEAN NOT NULL DEFAULT false,   -- peran bawaan tak bisa dihapus
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_nama ON roles (lower(nama));
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id BIGINT REFERENCES roles(id);

-- Peran bawaan; hanya dibuat sekali, aman dijalankan berulang.
INSERT INTO roles (nama, jelas, rute, uang, kelola, bawaan)
SELECT * FROM (VALUES
  ('Pemilik', 'Akses penuh termasuk pengaturan pengguna',
   ARRAY['*'], true, true, true),
  ('Keuangan', 'Semua laporan dan angka uang',
   ARRAY['/','/realtime','/laporan-toko','/mingguan','/keuangan','/pesanan','/master-sku','/gudang','/antrean'], true, false, true),
  ('Gudang', 'Pesanan, stok, dan Master SKU. Angka rupiah disembunyikan',
   ARRAY['/pesanan','/gudang','/master-sku','/produk','/antrean'], false, false, true),
  ('Operator Toko', 'Produk, salin listing, dan boost. Angka rupiah disembunyikan',
   ARRAY['/produk','/salin-listing','/boost','/master-sku','/pesanan','/antrean'], false, false, true)
) AS v(nama, jelas, rute, uang, kelola, bawaan)
WHERE NOT EXISTS (SELECT 1 FROM roles);

-- Sambungkan pengguna lama yang masih memakai kolom teks `peran`.
UPDATE users u SET role_id = r.id
FROM roles r
WHERE u.role_id IS NULL
  AND lower(r.nama) = CASE lower(COALESCE(u.peran,''))
        WHEN 'pemilik' THEN 'pemilik' WHEN 'keuangan' THEN 'keuangan'
        WHEN 'gudang' THEN 'gudang'   WHEN 'toko' THEN 'operator toko'
        ELSE 'gudang' END;

-- Rincian permintaan pembatalan dari pembeli.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_by      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_req_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;

-- ── Scan & Kirim: memindahkan pesanan dikemas → siap dijemput ──
-- Pencarian resi memakai bentuk yang sudah dinormalkan, jadi indexnya
-- harus atas bentuk yang sama persis. Tanpa index ini, tiap tembakan
-- barcode menyapu seluruh tabel pesanan dan halamannya merangkak
-- begitu antrean scan menumpuk.
CREATE INDEX IF NOT EXISTS idx_orders_resi_norm
  ON orders (upper(replace(tracking_no, ' ', '')))
  WHERE tracking_no IS NOT NULL;

-- Catatan setiap tembakan barcode, yang berhasil maupun yang gagal.
-- Angka besar dan riwayat di layar dibaca dari sini, bukan dari memori
-- peramban, supaya halaman boleh ditutup atau dimuat ulang kapan saja.
CREATE TABLE IF NOT EXISTS scan_log (
  id         BIGSERIAL PRIMARY KEY,
  resi       TEXT NOT NULL,
  order_id   BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  shop_id    BIGINT,
  order_sn   TEXT,
  carrier    TEXT,
  ok         BOOLEAN NOT NULL DEFAULT false,
  sebab      TEXT,            -- sukses | duplikat | tidak-ada | belum-pack | batal | ...
  pesan      TEXT,
  oleh       TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_waktu ON scan_log (scanned_at DESC);

-- ── Penyaring waktu di halaman Pesanan ──
-- Penyaringnya bisa dipindah kolom (dibuat / dibayar / dicetak / dikirim /
-- dibatalkan), jadi tiap kolom itu perlu indexnya sendiri. created_time dan
-- ship_time sudah punya di atas; tiga sisanya ditambahkan di sini.
CREATE INDEX IF NOT EXISTS idx_orders_paid ON orders (paid_at DESC)
  WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_printed ON orders (printed_at DESC)
  WHERE printed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cancelled ON orders (cancelled_at DESC)
  WHERE cancelled_at IS NOT NULL;

-- ── Penarikan tanggal pencairan (get_escrow_list) ──
-- get_escrow_detail tidak mengirim waktu sama sekali, jadi tanggal cair
-- ditarik terpisah lewat get_escrow_list yang mencari BERDASARKAN rentang
-- pencairan. Riwayatnya panjang, jadi penarikan mundur dikerjakan sepotong
-- demi sepotong dan posisinya disimpan di sini supaya tiap putaran
-- melanjutkan, bukan mengulang dari awal.
CREATE TABLE IF NOT EXISTS escrow_cair (
  shop_id       BIGINT PRIMARY KEY REFERENCES shops(shop_id) ON DELETE CASCADE,
  mundur_sampai TIMESTAMPTZ,                       -- sudah disapu mundur sampai kapan
  selesai       BOOLEAN NOT NULL DEFAULT false,    -- sudah mentok pesanan terlama
  ketemu        INTEGER NOT NULL DEFAULT 0,        -- tanggal cair yang berhasil diisi
  last_run      TIMESTAMPTZ,
  last_note     TEXT
);

-- ── Pack yang ditolak Shopee ──
-- Pesanan yang gagal di-Pack dipindahkan ke tabnya sendiri, jadi keadaannya
-- harus menempel di pesanan itu — bukan cuma tercatat di tabel jobs, yang
-- tidak bisa dipakai sebagai syarat tab.
-- jenis: 'gagal'       = ditolak Shopee, perlu ditindak
--        'marketplace' = Shopee belum siap memproses, coba lagi nanti
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_gagal_at    TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_gagal_jenis TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_gagal_kode  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_gagal_pesan TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_pack_gagal ON orders (pack_gagal_jenis, pack_gagal_at DESC)
  WHERE pack_gagal_at IS NOT NULL;

-- ── Kode jemput kurir instan ──
-- SPX Instant tidak punya nomor resi sampai pengirimannya diatur; Shopee
-- memakai pickup_code sebagai gantinya, dan tetap mau membuat labelnya.
-- Kodenya disimpan supaya bisa ditampilkan di layar.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;

-- ── Days of Supply: riwayat permintaan harus bertanggal KIRIM ──
-- Dulu stock_moves untuk pesanan memakai moved_at = waktu sinkronisasi,
-- sehingga seluruh riwayat menumpuk di hari saat sinkron kebetulan jalan.
-- Saldonya tidak terpengaruh (penjumlahan tidak peduli waktu), tapi
-- perhitungan permintaan harian jadi ngawur. Diperbaiki mundur di sini.
UPDATE stock_moves sm
   SET moved_at = o.ship_time
  FROM orders o
 WHERE sm.ref_type = 'order'
   AND sm.ref_id = o.id::text
   AND o.ship_time IS NOT NULL
   AND sm.moved_at <> o.ship_time;

CREATE INDEX IF NOT EXISTS idx_moves_waktu ON stock_moves (moved_at DESC);

-- ── Sisa penautan yang menggantung setelah Master SKU dihapus ──
-- sku_mapping.master_sku_id memakai ON DELETE SET NULL, jadi menghapus
-- Master SKU meninggalkan baris penautan tanpa tujuan. Baris itu tidak
-- berguna, dan dulu membuat SKU-nya tidak terlihat oleh mesin usulan
-- otomatis padahal daftar "belum tertaut" tetap menampilkannya.
DELETE FROM sku_mapping WHERE master_sku_id IS NULL;

-- ── Pesanan yang sudah punya resi berarti pengirimannya SUDAH diatur ──
-- Nomor resi hanya terbit setelah permintaan logistik dibuat — entah oleh
-- aplikasi ini lewat Pack, atau oleh Shopee/Seller Centre sendiri. Kalau
-- ship_arranged_at tetap kosong, pesanan itu menetap di tab "Pesanan baru",
-- tombol Pack menawarkannya lagi, dan Shopee menolak dengan
-- "Package ... not eligible for rescheduling" — pesanan tidak pernah maju.
UPDATE orders
   SET ship_arranged_at = COALESCE(ship_time, updated_at, now())
 WHERE ship_arranged_at IS NULL
   AND NULLIF(TRIM(COALESCE(tracking_no,'')),'') IS NOT NULL;

-- ── Pesanan disisihkan ──
-- Untuk pesanan yang stoknya kosong atau perlu ditahan: dikeluarkan dari
-- daftar siap-Pack supaya tidak ikut terproses, tanpa dibatalkan.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS disisihkan_at     TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS disisihkan_oleh   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS disisihkan_alasan TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_disisihkan ON orders (disisihkan_at DESC)
  WHERE disisihkan_at IS NOT NULL;

-- ── Antrean dikerjakan serombongan, per toko secara bersamaan ──
-- Karena beberapa tugas kini diambil sekaligus, proses yang mati di tengah
-- jalan bisa meninggalkan tugas berstatus 'running' selamanya. started_at
-- dipakai untuk mengenali dan mengembalikannya.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- ── ship_time diperbaiki dari jejak logistik ──
-- Sinkron pesanan mengisi ship_time dari update_time (waktu pesanan terakhir
-- BERUBAH), bukan waktu barang diserahkan ke kurir. Untuk pesanan yang
-- statusnya masih bergerak, angka itu terus maju: pesanan yang dikirim
-- tanggal 8 bisa tercatat tanggal 11 karena hari itu statusnya berubah lagi.
-- Jejak logistik menyimpan waktu tiap langkah dari kurir, jadi data lama
-- diperbaiki mundur dari situ. Yang lebih awal yang menang.
UPDATE orders o
   SET ship_time = t.serah
  FROM (
    SELECT o2.id,
           MIN((j->>'waktu')::timestamptz) AS serah
      FROM orders o2
      CROSS JOIN LATERAL jsonb_array_elements(o2.tracking_info) AS j
     WHERE jsonb_typeof(o2.tracking_info) = 'array'
       AND j->>'waktu' IS NOT NULL
       AND COALESCE(j->>'status','') || ' ' || COALESCE(j->>'catatan','')
           ~* '(PICKUP_DONE|PICKED_UP|LOGISTICS_REQUEST_CREATED|diserahkan|dijemput|handed over|picked up)'
     GROUP BY o2.id
  ) t
 WHERE o.id = t.id
   AND t.serah IS NOT NULL
   AND (o.ship_time IS NULL OR o.ship_time > t.serah);

-- ── Template ekspor pesanan ──
-- Susunan kolom yang bisa dibuat sendiri, dipakai bersama seluruh tim.
-- Isinya hanya daftar KUNCI kolom; nama dan cara mengambil datanya tetap
-- di lib/kolom-ekspor.js, supaya template lama tidak rusak saat definisi
-- kolomnya diperbaiki.
CREATE TABLE IF NOT EXISTS export_template (
  id         BIGSERIAL PRIMARY KEY,
  nama       TEXT NOT NULL,
  kunci      JSONB NOT NULL DEFAULT '[]'::jsonb,
  dibuat_oleh TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_nama ON export_template (lower(nama));

-- ── HPP pada tanggal tertentu, dengan cadangan ──
-- Dulu tiap laporan mencari HPP dengan syarat effective_from <= tanggal
-- pesanan. Akibatnya pesanan yang lebih TUA dari catatan HPP pertama
-- dihitung ber-HPP nol — laba jadi terlihat jauh lebih besar dari
-- sebenarnya, dan itu tidak kelihatan salah karena angkanya tetap wajar.
--
-- Sekarang: kalau tidak ada catatan yang berlaku pada tanggal itu, dipakai
-- catatan PALING AWAL yang ada. HPP yang dicatat belakangan tetap jauh
-- lebih dekat ke kenyataan daripada nol.
--
-- Ditaruh sebagai fungsi supaya definisinya hanya di satu tempat —
-- sebelumnya pola yang sama tersebar di lima kueri dan mudah berbeda
-- sendiri saat salah satunya diperbaiki.
CREATE OR REPLACE FUNCTION hpp_pada(p_sku BIGINT, p_tgl DATE)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT h.hpp FROM master_sku_hpp h
      WHERE h.master_sku_id = p_sku AND h.effective_from <= p_tgl
      ORDER BY h.effective_from DESC LIMIT 1),
    (SELECT h.hpp FROM master_sku_hpp h
      WHERE h.master_sku_id = p_sku
      ORDER BY h.effective_from ASC LIMIT 1),
    0);
$$;
