import { q, one, log } from './db';
import { call, beruntun, tidur } from './shopee';
import { EP, ORDER_DETAIL_BATCH, JEDA_MS } from './endpoints';
import { tokenHidup, tokoAktif, simpanToken } from './tokens';

const det = (d) => (d ? new Date(Number(d) * 1000) : null);

/**
 * Kurir dan resi dibaca berlapis. Shopee menaruhnya di tempat berbeda
 * tergantung tahap pesanan: kadang di kolom utama, kadang hanya di dalam
 * package_list. Kalau hanya membaca satu tempat, kolomnya tampil "—"
 * padahal datanya ada.
 */
const kurir = (o) =>
  o.shipping_carrier
  || o.checkout_shipping_carrier
  || o.package_list?.find((p) => p.shipping_carrier)?.shipping_carrier
  || null;

const resi = (o) =>
  o.package_list?.find((p) => p.tracking_number)?.tracking_number
  || o.tracking_number
  || null;

/**
 * Nomor paket. Shopee menuntutnya saat membuat dokumen resi untuk pesanan
 * yang punya paket — tanpa itu ia gagal menentukan paket mana yang dimaksud
 * dan membalas "The tracking number is invalid", yang menyesatkan.
 */
const paket = (o) =>
  o.package_list?.find((p) => p.package_number)?.package_number
  || o.package_number
  || null;

/** Ambil nama toko supaya UI tidak menampilkan angka shop_id. */
export async function tarikNamaToko(shopId) {
  const token = await tokenHidup(shopId);
  const json = await call(EP.shopInfo, { accessToken: token, shopId });
  const nama = json.shop_name || json.response?.shop_name || null;
  if (nama) await q('UPDATE shops SET shop_name = $2 WHERE shop_id = $1', [shopId, nama]);
  return nama;
}

/**
 * Tarik pesanan. Shopee membatasi rentang waktu per panggilan
 * (umumnya 15 hari), jadi rentang panjang dipecah otomatis.
 */
export async function tarikPesanan(shopId, {
  hariKeBelakang = 3, dariUnix = null, sampaiUnix = null, bidangWaktu = 'create_time',
} = {}) {
  const token = await tokenHidup(shopId);
  // Rentang boleh ditentukan langsung (dipakai penarikan riwayat ke belakang),
  // atau dihitung dari jumlah hari ke belakang seperti sinkron harian.
  const sampai = sampaiUnix ?? Math.floor(Date.now() / 1000);
  const dari   = dariUnix   ?? (sampai - hariKeBelakang * 86400);

  const semuaSn = [];
  const potong = [];
  for (let a = dari; a < sampai; a += 14 * 86400) {
    potong.push([a, Math.min(a + 14 * 86400, sampai)]);
  }

  for (const [a, b] of potong) {
    let cursor = '';
    for (let halaman = 0; halaman < 50; halaman++) {
      const json = await call(EP.orderList, {
        accessToken: token, shopId,
        params: {
          time_range_field: bidangWaktu,
          time_from: a, time_to: b,
          page_size: 100,
          cursor,
          response_optional_fields: 'order_status',
        },
      });
      const r = json.response || {};
      for (const it of r.order_list || []) semuaSn.push(it.order_sn);
      if (!r.more) break;
      cursor = r.next_cursor || '';
      if (!cursor) break;
    }
  }

  const unik = [...new Set(semuaSn)];
  const kelompok = [];
  for (let i = 0; i < unik.length; i += ORDER_DETAIL_BATCH) {
    kelompok.push(unik.slice(i, i + ORDER_DETAIL_BATCH));
  }

  let tersimpan = 0;
  await beruntun(kelompok, async (grup) => {
    const json = await call(EP.orderDetail, {
      accessToken: token, shopId,
      params: {
        order_sn_list: grup.join(','),
        response_optional_fields: 'item_list,recipient_address,total_amount,buyer_username,pay_time,ship_by_date,payment_method,message_to_seller,cancel_reason,package_list,shipping_carrier,checkout_shipping_carrier',
      },
    });
    for (const o of json.response?.order_list || []) {
      tersimpan += await simpanPesanan(shopId, o);
    }
  });

  await q('UPDATE shops SET last_sync_at = now() WHERE shop_id = $1', [shopId]);
  await log('sync', `Toko ${shopId}: ${tersimpan} pesanan disimpan`, { shopId });
  return tersimpan;
}

async function simpanPesanan(shopId, o) {
  const kirim = det(o.ship_by_date && o.order_status === 'SHIPPED' ? o.update_time : null)
             || (['SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED'].includes(o.order_status)
                 ? det(o.update_time) : null);

  const a = o.recipient_address || {};
  const row = await one(
    `INSERT INTO orders (shop_id, order_sn, status, buyer_username, region,
                         carrier, tracking_no, package_number, total_amount, created_time, ship_time,
                         ship_by_date, paid_at, completed_at, cancel_reason, cancel_by,
                         cancel_req_at, cancelled_at, payment_method,
                         recipient_name, phone, address, city, district, zipcode, buyer_message,
                         updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26, now())
     ON CONFLICT (shop_id, order_sn) DO UPDATE SET
       status         = EXCLUDED.status,
       carrier        = COALESCE(EXCLUDED.carrier, orders.carrier),
       tracking_no    = COALESCE(EXCLUDED.tracking_no, orders.tracking_no),
       -- Nomor resi dari Shopee berarti permintaan logistiknya SUDAH dibuat,
       -- entah oleh kita lewat Pack atau oleh Shopee/Seller Centre sendiri.
       -- Kalau ship_arranged_at tetap kosong, pesanan itu menetap di tab
       -- "Pesanan baru" dan tombol Pack akan menawarkannya lagi — lalu
       -- Shopee menolak dengan "Package ... not eligible for rescheduling".
       ship_arranged_at = COALESCE(orders.ship_arranged_at,
                                   CASE WHEN NULLIF(TRIM(COALESCE(EXCLUDED.tracking_no,'')),'') IS NOT NULL
                                        THEN COALESCE(EXCLUDED.ship_time, now()) END),
       package_number = COALESCE(EXCLUDED.package_number, orders.package_number),
       total_amount   = EXCLUDED.total_amount,
       -- update_time hanya dipakai kalau BELUM ada nilai sama sekali, dan
       -- tidak boleh menggeser nilai yang sudah ada. Sumber terbaiknya
       -- jejak logistik (lihat waktuSerah di lib/logistik.js); yang di sini
       -- sekadar dugaan awal supaya kolomnya tidak kosong sampai jejaknya
       -- ditarik. Menimpanya membuat pesanan yang dikirim tanggal 8
       -- tercatat tanggal 11 hanya karena statusnya berubah hari itu.
       ship_time      = COALESCE(orders.ship_time, EXCLUDED.ship_time),
       ship_by_date   = COALESCE(EXCLUDED.ship_by_date, orders.ship_by_date),
       paid_at        = COALESCE(EXCLUDED.paid_at, orders.paid_at),
       completed_at   = COALESCE(EXCLUDED.completed_at, orders.completed_at),
       cancel_reason  = COALESCE(EXCLUDED.cancel_reason, orders.cancel_reason),
       cancel_by      = COALESCE(EXCLUDED.cancel_by, orders.cancel_by),
       cancel_req_at  = COALESCE(EXCLUDED.cancel_req_at, orders.cancel_req_at),
       cancelled_at   = COALESCE(EXCLUDED.cancelled_at, orders.cancelled_at),
       payment_method = COALESCE(EXCLUDED.payment_method, orders.payment_method),
       recipient_name = COALESCE(EXCLUDED.recipient_name, orders.recipient_name),
       phone          = COALESCE(EXCLUDED.phone, orders.phone),
       address        = COALESCE(EXCLUDED.address, orders.address),
       city           = COALESCE(EXCLUDED.city, orders.city),
       district       = COALESCE(EXCLUDED.district, orders.district),
       zipcode        = COALESCE(EXCLUDED.zipcode, orders.zipcode),
       buyer_message  = COALESCE(EXCLUDED.buyer_message, orders.buyer_message),
       updated_at     = now()
     RETURNING id`,
    [shopId, o.order_sn, o.order_status, o.buyer_username || null,
     a.state || null, kurir(o), resi(o), paket(o),
     Number(o.total_amount) || 0, det(o.create_time), kirim,
     det(o.ship_by_date), det(o.pay_time),
     o.order_status === 'COMPLETED' ? det(o.update_time) : null,
     o.cancel_reason || null, o.cancel_by || null,
     // IN_CANCEL = pembeli sedang minta batal; update_time saat itu adalah
     // waktu permintaannya. Kalau sudah CANCELLED, itu waktu pembatalannya.
     (o.order_status === 'IN_CANCEL' ? det(o.update_time) : null),
     (o.order_status === 'CANCELLED' ? det(o.update_time) : null),
     o.payment_method || null,
     a.name || null, a.phone || null, a.full_address || null,
     a.city || null, a.district || null, a.zipcode || null,
     o.message_to_seller || null]);

  await q('DELETE FROM order_items WHERE order_id = $1', [row.id]);
  for (const it of o.item_list || []) {
    await q(
      `INSERT INTO order_items (order_id, item_id, model_id, item_name, item_sku, model_sku, qty, price, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, it.item_id || null, it.model_id || null, it.item_name || null,
       it.item_sku || null, it.model_sku || null,
       Number(it.model_quantity_purchased) || 1,
       Number(it.model_discounted_price ?? it.model_original_price) || 0,
       it.image_info?.image_url || null]);
  }
  return 1;
}

/**
 * Tarik pesanan untuk satu potongan waktu tertentu. Dipakai penarikan
 * riwayat ke belakang, dikerjakan lewat antrean satu potongan per tugas —
 * karena 90 hari sekali jalan pasti melewati batas waktu permintaan.
 */
export async function tarikRiwayat(shopId, dariUnix, sampaiUnix) {
  // Riwayat memakai create_time: yang dicari memang pesanan yang DIBUAT
  // pada rentang itu, bukan yang kebetulan berubah.
  const n = await tarikPesanan(shopId, { dariUnix, sampaiUnix, bidangWaktu: 'create_time' });
  await log('riwayat',
    `Toko ${shopId}: ${n} pesanan dari ${new Date(dariUnix * 1000).toLocaleDateString('id-ID')}`
    + ` s/d ${new Date(sampaiUnix * 1000).toLocaleDateString('id-ID')}`, { shopId });
  return n;
}

/** Tarik rincian dana diterima untuk pesanan yang belum punya escrow. */
export async function tarikEscrow(shopId, { batas = 150 } = {}) {
  const token = await tokenHidup(shopId);
  /**
   * Yang ditarik:
   *  - belum punya rincian dana sama sekali
   *  - punya rincian tapi nilainya nol (ditarik terlalu dini)
   *  - punya nilai tapi TANGGAL PENCAIRAN kosong — pesanan lama yang
   *    ditarik sebelum kolom release_at ada. Tanpa ini, seluruh riwayat
   *    tidak akan pernah muncul di laporan mingguan.
   */
  const perlu = await q(
    `SELECT o.id, o.order_sn FROM orders o
     LEFT JOIN order_escrow e ON e.order_id = o.id
     WHERE o.shop_id = $1
       AND (e.order_id IS NULL
            OR COALESCE(e.escrow_amount,0) = 0
            OR e.release_at IS NULL)
       AND o.status IN ('COMPLETED','TO_CONFIRM_RECEIVE')
     ORDER BY o.created_time DESC LIMIT $2`, [shopId, batas]);

  let n = 0;
  await beruntun(perlu, async (o) => {
    try {
      const json = await call(EP.escrowDetail, {
        accessToken: token, shopId, params: { order_sn: o.order_sn },
      });
      const r = json.response || {};
      const inc = r.order_income || {};
      /**
       * Tanggal pelepasan dana. Nama kolomnya berbeda-beda antar versi
       * dokumen Shopee, jadi semua kemungkinan diperiksa. Kalau tidak
       * ketemu, dibiarkan kosong — LEBIH BAIK kosong daripada diisi
       * tanggal lain, karena inilah dasar periode laporan keuangan.
       */
      const detik = r.escrow_release_time ?? inc.escrow_release_time
                 ?? r.payout_time ?? r.release_time ?? inc.release_time ?? null;
      const cair = detik && Number(detik) > 1e9 ? new Date(Number(detik) * 1000) : null;
      await q(
        `INSERT INTO order_escrow (order_id, gross_amount, buyer_paid, commission_fee,
                                   service_fee, seller_discount, shopee_subsidy, escrow_amount,
                                   release_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (order_id) DO UPDATE SET
           commission_fee = EXCLUDED.commission_fee,
           service_fee    = EXCLUDED.service_fee,
           escrow_amount  = EXCLUDED.escrow_amount,
           release_at     = COALESCE(EXCLUDED.release_at, order_escrow.release_at),
           fetched_at     = now()`,
        [o.id, Number(inc.original_price) || 0, Number(inc.buyer_total_amount) || 0,
         Number(inc.commission_fee) || 0, Number(inc.service_fee) || 0,
         Number(inc.seller_discount) || 0, Number(inc.shopee_discount) || 0,
         Number(inc.escrow_amount) || 0, cair]);
      n++;
    } catch (e) {
      if (e.kind === 'rate_limit') throw e;   // hentikan, biarkan antrean coba lagi
    }
  });
  return n;
}

/**
 * Potong stok gudang untuk pesanan yang SUDAH DIKIRIM dan belum diproses.
 * Bundling diuraikan ke komponennya.
 */
export async function potongStokTerkirim() {
  const baris = await q(`
    SELECT o.id AS order_id, o.order_sn, o.shop_id, o.ship_time, oi.qty, oi.item_sku, oi.model_sku
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.ship_time IS NOT NULL AND o.stock_applied = false
    ORDER BY o.ship_time LIMIT 2000`);

  const perPesanan = new Map();
  for (const b of baris) {
    if (!perPesanan.has(b.order_id)) perPesanan.set(b.order_id, []);
    perPesanan.get(b.order_id).push(b);
  }

  let n = 0;
  for (const [orderId, items] of perPesanan) {
    /**
     * Jumlah per master SKU dikumpulkan DULU untuk seluruh pesanan, baru
     * disimpan sekali.
     *
     * Kalau tidak: satu pesanan yang berisi tensimeter satuan DAN paket
     * yang mengandung tensimeter akan menulis dua baris dengan kunci sama.
     * Baris kedua ditolak indeks unik, dan potongannya hilang diam-diam —
     * stok gudang jadi lebih banyak dari kenyataan. Justru kebalikan dari
     * tujuan Master SKU.
     */
    const perMaster = new Map();
    for (const it of items) {
      const m = await one(
        `SELECT master_sku_id FROM sku_mapping
         WHERE shop_id = $1 AND shop_sku IN ($2, $3) AND master_sku_id IS NOT NULL
         LIMIT 1`, [it.shop_id, it.model_sku || '', it.item_sku || '']);
      if (!m) continue;

      const ms = await one('SELECT id, kind FROM master_sku WHERE id = $1', [m.master_sku_id]);
      if (!ms) continue;

      const daun = ms.kind === 'paket'
        ? await q('SELECT child_id AS id, qty FROM master_sku_component WHERE parent_id = $1', [ms.id])
        : [{ id: ms.id, qty: 1 }];

      for (const d of daun) {
        const kunci = String(d.id);
        perMaster.set(kunci, (perMaster.get(kunci) || 0) + it.qty * d.qty);
      }
    }

    for (const [masterId, qty] of perMaster) {
      // moved_at diisi TANGGAL KIRIM, bukan waktu sinkronisasi berjalan.
      // Kalau dibiarkan now(), seluruh riwayat permintaan menumpuk di hari
      // saat sinkron kebetulan jalan — dan perhitungan Days of Supply akan
      // membaca lonjakan palsu di satu hari lalu sepi di hari lainnya.
      await q(
        `INSERT INTO stock_moves (master_sku_id, direction, qty, ref_type, ref_id, note, moved_at)
         VALUES ($1,'out',$2,'order',$3,$4, COALESCE($5::timestamptz, now()))
         ON CONFLICT (ref_type, ref_id, master_sku_id) WHERE ref_type = 'order'
         DO UPDATE SET qty = EXCLUDED.qty, moved_at = EXCLUDED.moved_at`,
        [masterId, qty, `${orderId}`, `Pesanan ${items[0]?.order_sn || orderId}`,
         items[0]?.ship_time || null]);
    }

    await q('UPDATE orders SET stock_applied = true WHERE id = $1', [orderId]);
    n++;
  }
  return n;
}

/** Tautkan otomatis SKU toko yang penulisannya persis sama dengan kode master SKU. */
/**
 * Tautkan SKU toko ke Master SKU secara otomatis.
 *
 * Dua perbaikan dari versi awal:
 *  1. Sumbernya bukan cuma pesanan, tapi juga KATALOG PRODUK — kalau tidak,
 *     produk di toko yang baru dihubungkan tidak terlihat sampai ada yang laku.
 *  2. Pencocokan memakai kunci yang dinormalkan (huruf besar, spasi/tanda
 *     baca dibuang), jadi "NEBULIZER JSL - W302" dan "NEBULIZER JSL W302"
 *     dikenali sebagai satu barang.
 *
 * Yang TIDAK dilakukan di sini: membuat Master SKU baru. Itu tetap lewat
 * tombol "Buat otomatis dari katalog" yang ada pratinjaunya, supaya tidak
 * diam-diam melahirkan master SKU sampah.
 */
export async function tautkanOtomatis() {
  const r = await q(`
    WITH sumber AS (
      SELECT DISTINCT o.shop_id, x.sku
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      CROSS JOIN LATERAL (VALUES (oi.model_sku), (oi.item_sku)) AS x(sku)
      WHERE NULLIF(TRIM(x.sku), '') IS NOT NULL
      UNION
      SELECT DISTINCT p.shop_id, y.sku
      FROM products p
      LEFT JOIN product_models pm ON pm.product_id = p.id
      CROSS JOIN LATERAL (VALUES (pm.model_sku), (p.item_sku)) AS y(sku)
      WHERE NULLIF(TRIM(y.sku), '') IS NOT NULL
    ),
    norm AS (
      SELECT shop_id, sku,
             regexp_replace(upper(trim(sku)), '[^A-Z0-9]', '', 'g') AS kunci
      FROM sumber
    ),
    mk AS (
      SELECT id, regexp_replace(upper(trim(code)), '[^A-Z0-9]', '', 'g') AS kunci
      FROM master_sku
    )
    INSERT INTO sku_mapping (shop_id, shop_sku, master_sku_id, auto_linked)
    SELECT DISTINCT ON (n.shop_id, n.sku) n.shop_id, n.sku, mk.id, true
    FROM norm n
    JOIN mk ON mk.kunci = n.kunci
    WHERE n.kunci <> ''
    ORDER BY n.shop_id, n.sku, mk.id
    ON CONFLICT (shop_id, shop_sku) DO NOTHING
    RETURNING id`);
  return r.length;
}

/** Satu putaran sinkronisasi penuh untuk semua toko aktif. */
/**
 * Sinkron rutin memakai update_time, BUKAN create_time.
 *
 * Kalau menyaring dengan create_time, pesanan yang dibuat 4 hari lalu lalu
 * hari ini berubah jadi Dikirim atau Selesai tidak akan pernah ikut ditarik —
 * statusnya membeku di database dan halaman Pesanan jadi salah. update_time
 * menangkap perubahan apa pun, setua apa pun pesanannya.
 */
export async function sinkronSemua({ hariKeBelakang = 3, bidangWaktu = 'update_time' } = {}) {
  const toko = await tokoAktif();
  const hasil = [];
  for (const t of toko) {
    try {
      if (!t.shop_name) await tarikNamaToko(t.shop_id).catch(() => {});
      const p = await tarikPesanan(t.shop_id, { hariKeBelakang, bidangWaktu });
      const e = await tarikEscrow(t.shop_id).catch(() => 0);
      hasil.push({ shopId: String(t.shop_id), pesanan: p, escrow: e, ok: true });
    } catch (err) {
      await log('sync', `Toko ${t.shop_id} gagal: ${err.message}`, { shopId: t.shop_id, ok: false });
      hasil.push({ shopId: String(t.shop_id), ok: false, error: err.message });
    }
  }
  await tautkanOtomatis().catch(() => 0);
  await potongStokTerkirim().catch(() => 0);
  return hasil;
}


/**
 * Tarik katalog produk: daftar item -> info dasar -> varian.
 *
 * get_model_list hanya menerima SATU item per panggilan, jadi varian
 * ditarik bertahap: setiap kali dijalankan, hanya sejumlah produk yang
 * belum punya varian yang diproses. Jalankan beberapa kali sampai
 * "produk lengkap" sama dengan total produk.
 */
export async function tarikProduk(shopId, { maksModel = 120, status = 'NORMAL,UNLIST,BANNED' } = {}) {
  const token = await tokenHidup(shopId);

  // 1. Kumpulkan seluruh item_id, per status.
  //    Shopee menolak beberapa status dalam satu panggilan, jadi dipisah.
  //    Satu status yang ditolak tidak boleh menjatuhkan seluruh tarikan.
  const ids = [];
  const catatan = [];
  for (const st of String(status).split(',').map((x) => x.trim()).filter(Boolean)) {
    let offset = 0;
    for (let hal = 0; hal < 60; hal++) {
      let json;
      try {
        json = await call(EP.itemList, {
          accessToken: token, shopId,
          params: { offset, page_size: 100, item_status: st },
        });
      } catch (e) {
        if (e.kind === 'rate_limit') throw e;
        // Status yang ditolak dicatat, tapi tidak menjatuhkan status lain.
        catatan.push(`get_item_list[${st}]: ${e.shopeeCode || ''} ${e.message}`.trim());
        break;
      }
      const r = json.response || {};
      for (const it of r.item || []) ids.push(it.item_id);
      if (!r.has_next_page) break;
      offset = r.next_offset ?? offset + 100;
      await tidur(JEDA_MS);
    }
    await tidur(JEDA_MS);
  }

  if (!ids.length) {
    const sebab = catatan.length ? catatan.join(' | ') : 'Shopee tidak mengembalikan satu produk pun';
    throw new Error(`Daftar produk kosong — ${sebab}`);
  }

  // 2. Info dasar, 50 item per panggilan
  const kelompok = [];
  for (let i = 0; i < ids.length; i += 50) kelompok.push(ids.slice(i, i + 50));

  let simpan = 0;
  try {
  await beruntun(kelompok, async (grup) => {
    const json = await call(EP.itemBaseInfo, {
      accessToken: token, shopId, params: { item_id_list: grup.join(',') },
    });
    for (const it of json.response?.item_list || []) {
      const gambar = it.image?.image_url_list?.[0] || it.image?.image_id_list?.[0] || null;
      await q(
        `INSERT INTO products (shop_id, item_id, name, item_sku, status, image_url, category_id, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (shop_id, item_id) DO UPDATE SET
           name = EXCLUDED.name, item_sku = EXCLUDED.item_sku, status = EXCLUDED.status,
           image_url = COALESCE(EXCLUDED.image_url, products.image_url),
           category_id = EXCLUDED.category_id, synced_at = now()`,
        [shopId, it.item_id, it.item_name || null, it.item_sku || null,
         it.item_status || null, gambar, it.category_id || null]);
      simpan++;

      // Produk tanpa varian: buat satu baris model semu agar harga & stok tetap tersimpan
      if (!it.has_model) {
        const harga = it.price_info?.[0]?.current_price ?? null;
        const stok = it.stock_info_v2?.summary_info?.total_available_stock
                  ?? it.stock_info?.[0]?.current_stock ?? null;
        const row = await one('SELECT id FROM products WHERE shop_id=$1 AND item_id=$2', [shopId, it.item_id]);
        await q(
          `INSERT INTO product_models (product_id, model_id, model_name, model_sku, price, stock)
           VALUES ($1,0,'',$2,$3,$4)
           ON CONFLICT (product_id, model_id) DO UPDATE SET
             model_sku = EXCLUDED.model_sku, price = EXCLUDED.price, stock = EXCLUDED.stock`,
          [row.id, it.item_sku || null, harga, stok]);
      }
    }
  });
  } catch (e) {
    throw new Error(`get_item_base_info gagal: ${e.shopeeCode || ''} ${e.message}`.trim());
  }

  // 3. Varian, bertahap
  const perluModel = await q(
    `SELECT p.id, p.item_id FROM products p
     WHERE p.shop_id = $1
       AND NOT EXISTS (SELECT 1 FROM product_models m WHERE m.product_id = p.id)
     ORDER BY p.id LIMIT $2`, [shopId, maksModel]);

  let varian = 0;
  await beruntun(perluModel, async (p) => {
    try {
      const json = await call(EP.modelList, {
        accessToken: token, shopId, params: { item_id: p.item_id },
      });
      for (const m of json.response?.model || []) {
        const harga = m.price_info?.[0]?.current_price ?? m.price_info?.current_price ?? null;
        const stok = m.stock_info_v2?.summary_info?.total_available_stock
                  ?? m.stock_info?.[0]?.current_stock ?? null;
        await q(
          `INSERT INTO product_models (product_id, model_id, model_name, model_sku, price, stock)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (product_id, model_id) DO UPDATE SET
             model_name = EXCLUDED.model_name, model_sku = EXCLUDED.model_sku,
             price = EXCLUDED.price, stock = EXCLUDED.stock`,
          [p.id, m.model_id, m.model_name || null, m.model_sku || null, harga, stok]);
        varian++;
      }
    } catch (e) {
      if (e.kind === 'rate_limit') throw e;
    }
  });

  await log('produk', `Toko ${shopId}: ${simpan} produk, ${varian} varian tersimpan`, { shopId });
  return { produk: simpan, varian, sisa: Math.max(ids.length - simpan, 0) };
}

/** Tarik katalog untuk semua toko aktif. */
export async function tarikProdukSemua(opsi = {}) {
  const toko = await tokoAktif();
  const hasil = [];
  for (const t of toko) {
    try {
      const r = await tarikProduk(t.shop_id, opsi);
      hasil.push({ shopId: String(t.shop_id), ...r, ok: true });
    } catch (e) {
      await log('produk', `Toko ${t.shop_name || t.shop_id} gagal: ${e.message}`,
        { shopId: t.shop_id, ok: false });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, ok: false, error: e.message });
    }
  }
  return hasil;
}

export { simpanToken };

/**
 * ── Tanggal pencairan dana ──
 *
 * get_escrow_detail TIDAK mengirim satu pun field waktu untuk akun ini —
 * sudah dibuktikan lewat /api/diagnosa-escrow: 34.455 pesanan punya nilai
 * escrow, nol punya tanggal, dan penelusur stempel waktu pulang kosong.
 *
 * Tanggalnya hanya ada di get_escrow_list, yang bekerja terbalik: dia
 * mencari BERDASARKAN rentang pencairan lalu mengembalikan daftar pesanan
 * yang cair di rentang itu. Jadi ini bukan penarikan per pesanan, tapi
 * penyapuan per rentang waktu — jauh lebih hemat panggilan untuk mengisi
 * puluhan ribu pesanan lama.
 */

/** Satu rentang waktu, semua halamannya, untuk satu toko. */
export async function tarikTanggalCair(shopId, { dariUnix, sampaiUnix, maksHalaman = 30 } = {}) {
  const token = await tokenHidup(shopId);
  let halaman = 1, dilihat = 0, terisi = 0;

  while (halaman <= maksHalaman) {
    const json = await call(EP.escrowList, {
      accessToken: token, shopId,
      params: {
        release_time_from: dariUnix, release_time_to: sampaiUnix,
        page_size: 40, page_no: halaman,
      },
    });
    const r = json.response || {};
    const daftar = Array.isArray(r.escrow_list) ? r.escrow_list : [];
    if (!daftar.length) break;

    const sn = [], cair = [];
    for (const x of daftar) {
      const detik = Number(x.escrow_release_time);
      if (!x.order_sn || !Number.isFinite(detik) || detik < 1e9) continue;
      sn.push(String(x.order_sn));
      cair.push(new Date(detik * 1000).toISOString());
    }
    dilihat += daftar.length;

    if (sn.length) {
      // Pesanan yang belum punya baris escrow dibuatkan dulu, dengan nilai
      // NOL. Sengaja nol, bukan payout_amount: baris bernilai nol tetap
      // terjaring tarikEscrow sehingga rincian komisi dan biaya layanannya
      // ikut terisi nanti. Kalau diisi payout_amount, barisnya terlihat
      // lengkap padahal rinciannya kosong selamanya.
      // RETURNING dipakai supaya baris yang BARU DIBUAT ikut terhitung.
      // Tanpa ini angkanya berbohong: baris baru sudah lahir dengan tanggal,
      // jadi UPDATE di bawah tidak menyentuhnya dan layar melaporkan nol
      // padahal ribuan tanggal baru saja terisi.
      const baru = await q(`
        INSERT INTO order_escrow (order_id, escrow_amount, release_at)
        SELECT o.id, 0, t.cair
          FROM (SELECT unnest($2::text[]) AS sn, unnest($3::timestamptz[]) AS cair) t
          JOIN orders o ON o.order_sn = t.sn AND o.shop_id = $1
          LEFT JOIN order_escrow e ON e.order_id = o.id
         WHERE e.order_id IS NULL
        ON CONFLICT (order_id) DO NOTHING
        RETURNING order_id`, [shopId, sn, cair]);
      terisi += baru.length;

      const upd = await q(`
        UPDATE order_escrow e
           SET release_at = t.cair
          FROM (SELECT unnest($2::text[]) AS sn, unnest($3::timestamptz[]) AS cair) t
          JOIN orders o ON o.order_sn = t.sn AND o.shop_id = $1
         WHERE e.order_id = o.id
           AND e.release_at IS DISTINCT FROM t.cair
        RETURNING e.order_id`, [shopId, sn, cair]);
      terisi += upd.length;
    }

    if (!r.more) break;
    halaman++;
  }
  return { dilihat, terisi };
}

/**
 * Penyapuan mundur bertahap untuk satu toko.
 *
 * Riwayatnya setahun lebih dan rentang tiap panggilan terbatas, jadi
 * pekerjaannya dipotong-potong dan posisinya disimpan di tabel escrow_cair.
 * Tiap putaran melanjutkan dari tempat terakhir berhenti, bukan mengulang.
 */
export async function sapuCairToko(shopId, { potongan = 3, hariPerPotong = 7, majuHari = 3 } = {}) {
  const HARI = 86400;
  const sekarang = Math.floor(Date.now() / 1000);
  let terisi = 0, dilihat = 0;

  await q(`INSERT INTO escrow_cair (shop_id) VALUES ($1) ON CONFLICT (shop_id) DO NOTHING`, [shopId]);
  const [kursor] = await q(`SELECT * FROM escrow_cair WHERE shop_id = $1`, [shopId]);

  // Sapuan maju selalu dijalankan lebih dulu: pencairan baru terjadi tiap
  // hari, dan itu yang paling dibutuhkan laporan minggu berjalan.
  const maju = await tarikTanggalCair(shopId, {
    dariUnix: sekarang - majuHari * HARI, sampaiUnix: sekarang });
  terisi += maju.terisi; dilihat += maju.dilihat;

  if (!kursor?.selesai) {
    // Batas bawah: pesanan terlama toko ini. Dana tidak mungkin cair
    // sebelum pesanannya ada, jadi menyapu lebih jauh hanya buang panggilan.
    const [batas] = await q(
      `SELECT EXTRACT(EPOCH FROM MIN(created_time))::bigint AS awal
         FROM orders WHERE shop_id = $1`, [shopId]);
    const paling = Number(batas?.awal) || (sekarang - 400 * HARI);

    let sampai = kursor?.mundur_sampai
      ? Math.floor(new Date(kursor.mundur_sampai).getTime() / 1000)
      : sekarang;
    let selesai = false;

    for (let i = 0; i < potongan; i++) {
      const dari = sampai - hariPerPotong * HARI;
      const hasil = await tarikTanggalCair(shopId, { dariUnix: Math.max(dari, paling), sampaiUnix: sampai });
      terisi += hasil.terisi; dilihat += hasil.dilihat;
      sampai = dari;
      if (sampai <= paling) { selesai = true; break; }
    }

    await q(`UPDATE escrow_cair
                SET mundur_sampai = to_timestamp($2), selesai = $3,
                    ketemu = ketemu + $4, last_run = now(), last_note = $5
              WHERE shop_id = $1`,
      [shopId, Math.max(sampai, paling), selesai, terisi,
       `${terisi} tanggal terisi dari ${dilihat} baris`]);
  } else {
    await q(`UPDATE escrow_cair SET ketemu = ketemu + $2, last_run = now(), last_note = $3
              WHERE shop_id = $1`,
      [shopId, terisi, `sapuan maju: ${terisi} dari ${dilihat} baris`]);
  }

  return { shopId, terisi, dilihat };
}

/** Semua toko sekaligus. Kegagalan satu toko tidak menjatuhkan yang lain. */
export async function sapuCairSemua(opsi = {}) {
  const hasil = [];
  for (const t of await tokoAktif()) {
    try {
      hasil.push({ ok: true, nama: t.shop_name, ...(await sapuCairToko(t.shop_id, opsi)) });
    } catch (e) {
      hasil.push({ ok: false, nama: t.shop_name, shopId: t.shop_id, error: e.message });
    }
  }
  return hasil;
}
