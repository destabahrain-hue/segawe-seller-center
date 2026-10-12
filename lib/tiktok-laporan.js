import { q, one } from './db';

/**
 * ── Penautan SKU TikTok & laporan TikTok ──
 *
 * HPP dihitung lewat master_sku persis seperti Shopee, termasuk penguraian
 * paket bundling dan hpp_pada() yang menghormati tanggal berlaku. Yang
 * berbeda cuma jalan masuknya: Shopee lewat sku_mapping (per shop_id angka),
 * TikTok lewat tiktok_sku_mapping (per seller_sku teks).
 *
 * SKU yang belum tertaut TIDAK dianggap HPP nol diam-diam — jumlahnya
 * selalu dilaporkan, karena HPP nol membuat laba terlihat jauh lebih besar
 * dari kenyataan. Itu persis kesalahan yang pernah membuat laba Agustus
 * Shopee terlalu tinggi selama berminggu-minggu.
 */

/** Cocokkan otomatis seller_sku dengan kode Master SKU yang sama persis. */
export async function cocokkanOtomatis() {
  const baru = await q(`
    INSERT INTO tiktok_sku_mapping (shop_id, seller_sku, master_sku_id, auto_linked)
    SELECT DISTINCT i.shop_id, i.seller_sku, ms.id, true
      FROM tiktok_order_items i
      JOIN master_sku ms ON UPPER(TRIM(ms.code)) = UPPER(TRIM(i.seller_sku))
     WHERE i.seller_sku IS NOT NULL AND TRIM(i.seller_sku) <> ''
    ON CONFLICT (shop_id, seller_sku) DO UPDATE
      SET master_sku_id = COALESCE(tiktok_sku_mapping.master_sku_id, EXCLUDED.master_sku_id),
          auto_linked = tiktok_sku_mapping.master_sku_id IS NULL
    RETURNING id`);

  // Catat juga SKU yang belum ketemu padanannya, supaya muncul di daftar
  // "belum tertaut" dan bisa ditautkan manual.
  await q(`
    INSERT INTO tiktok_sku_mapping (shop_id, seller_sku, master_sku_id, auto_linked)
    SELECT DISTINCT i.shop_id, i.seller_sku, NULL::bigint, false
      FROM tiktok_order_items i
     WHERE i.seller_sku IS NOT NULL AND TRIM(i.seller_sku) <> ''
    ON CONFLICT (shop_id, seller_sku) DO NOTHING`);

  return { tertaut: baru.length };
}

export async function tautkanSku(shopId, sellerSku, masterSkuId) {
  await q(`
    INSERT INTO tiktok_sku_mapping (shop_id, seller_sku, master_sku_id, auto_linked)
    VALUES ($1,$2,$3,false)
    ON CONFLICT (shop_id, seller_sku) DO UPDATE
      SET master_sku_id = EXCLUDED.master_sku_id, auto_linked = false`,
    [String(shopId), sellerSku, masterSkuId || null]);
}

/** Daftar SKU TikTok + status penautannya, untuk halaman kelola. */
export async function daftarSkuTiktok({ hanyaBelum = false } = {}) {
  return q(`
    SELECT i.shop_id, i.seller_sku,
           MAX(i.product_name)                AS produk,
           MAX(i.sku_name)                    AS varian,
           (ARRAY_AGG(i.sku_image ORDER BY i.line_item_id DESC)
              FILTER (WHERE i.sku_image IS NOT NULL))[1] AS gambar,
           COUNT(*)::int                      AS terjual,
           SUM(i.sale_price)                  AS omzet,
           m.master_sku_id, ms.code           AS master_code, ms.name AS master_nama,
           m.auto_linked
      FROM tiktok_order_items i
      LEFT JOIN tiktok_sku_mapping m ON m.shop_id = i.shop_id AND m.seller_sku = i.seller_sku
      LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
     WHERE i.seller_sku IS NOT NULL
       ${hanyaBelum ? 'AND m.master_sku_id IS NULL' : ''}
     GROUP BY i.shop_id, i.seller_sku, m.master_sku_id, ms.code, ms.name, m.auto_linked
     ORDER BY SUM(i.sale_price) DESC NULLS LAST`);
}

/**
 * Ringkasan TikTok untuk satu rentang, sebentuk dengan ringkasan Shopee di
 * lib/report.js supaya bisa disandingkan di Laporan Toko.
 *
 * Omzet = harga jual baris pesanan sah.
 *
 * BIAYA PLATFORM diambil dari statement (fee_amount), bukan ditaksir per
 * pesanan — TikTok memang tidak memberi potongan per pesanan. Karena
 * statement bertanggal pencairan sementara pesanan bertanggal dibuat,
 * keduanya tidak selalu sebaris pada rentang pendek. Itu disebut di layar,
 * dan pada rentang sebulan penuh selisihnya kecil.
 *
 * BIAYA IKLAN diisi manual (tiktok_ad_spend) karena iklan TikTok Shop tidak
 * tersedia di API Shop. Kalau belum diisi, angkanya nol dan laba bersih
 * terlihat lebih besar — karena itu jumlah hari yang kosong ikut dilaporkan.
 */
export async function ringkasanTiktok({ dari, sampai } = {}) {
  return q(`
    WITH baris AS (
      SELECT o.shop_id, o.order_id, i.line_item_id, i.seller_sku,
             i.sale_price AS omzet, 1 AS unit,
             (o.create_time AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
             m.master_sku_id
        FROM tiktok_orders o
        JOIN tiktok_order_items i ON i.order_id = o.order_id
        LEFT JOIN tiktok_sku_mapping m ON m.shop_id = o.shop_id AND m.seller_sku = i.seller_sku
       WHERE o.status NOT IN ('CANCELLED','UNPAID')
         AND o.create_time >= $1 AND o.create_time < $2
    ),
    daun AS (
      SELECT b.*, COALESCE(c.child_id, b.master_sku_id) AS daun_id,
             COALESCE(c.qty, 1) AS daun_qty
        FROM baris b
        LEFT JOIN master_sku ms ON ms.id = b.master_sku_id
        LEFT JOIN master_sku_component c ON c.parent_id = ms.id AND ms.kind = 'paket'
    ),
    hpp AS (
      SELECT line_item_id, MAX(shop_id) AS shop_id, MAX(omzet) AS omzet, MAX(unit) AS unit,
             MAX(order_id) AS order_id,
             BOOL_OR(master_sku_id IS NULL) AS tanpa_taut,
             SUM(daun_qty * hpp_pada(daun_id, tgl)) AS hpp
        FROM daun GROUP BY line_item_id
    )
    SELECT h.shop_id,
           t.shop_name,
           COUNT(DISTINCT h.order_id)::int                       AS pesanan,
           SUM(h.omzet)                                          AS omzet,
           SUM(h.unit)::int                                      AS unit,
           SUM(COALESCE(h.hpp, 0))                               AS hpp,
           SUM(h.omzet) - SUM(COALESCE(h.hpp, 0))                AS margin,
           COUNT(*) FILTER (WHERE h.tanpa_taut)::int             AS baris_tanpa_taut,
           COUNT(*) FILTER (WHERE COALESCE(h.hpp,0) = 0)::int    AS baris_hpp_nol
      FROM hpp h LEFT JOIN tiktok_shops t ON t.shop_id = h.shop_id
     GROUP BY h.shop_id, t.shop_name
     ORDER BY SUM(h.omzet) DESC`, [dari, sampai]);
}

/** Berapa uang TikTok yang benar-benar cair pada rentang ini. */
export async function cairTiktok({ dari, sampai } = {}) {
  return one(`
    SELECT COALESCE(SUM(settlement_amount), 0) AS cair,
           COALESCE(SUM(fee_amount), 0)        AS biaya,
           COUNT(*)::int                        AS statement
      FROM tiktok_statements
     WHERE statement_time >= $1 AND statement_time < $2`, [dari, sampai]);
}

/** Biaya platform (dari statement) & iklan (manual) per toko pada rentang. */
export async function biayaTiktok({ dari, sampai } = {}) {
  const rows = await q(`
    SELECT t.shop_id,
           COALESCE(st.biaya, 0)      AS biaya_platform,
           COALESCE(st.cair, 0)       AS cair,
           COALESCE(ik.iklan, 0)      AS iklan,
           COALESCE(ik.hari_terisi, 0)::int AS hari_iklan_terisi
      FROM tiktok_shops t
      LEFT JOIN (
        SELECT shop_id, ABS(SUM(fee_amount)) AS biaya, SUM(settlement_amount) AS cair
          FROM tiktok_statements
         WHERE statement_time >= $1 AND statement_time < $2
         GROUP BY shop_id) st ON st.shop_id = t.shop_id
      LEFT JOIN (
        SELECT shop_id, SUM(biaya) AS iklan, COUNT(*) AS hari_terisi
          FROM tiktok_ad_spend
         WHERE day >= ($1 AT TIME ZONE 'Asia/Jakarta')::date
           AND day <  ($2 AT TIME ZONE 'Asia/Jakarta')::date
         GROUP BY shop_id) ik ON ik.shop_id = t.shop_id`, [dari, sampai]);
  return Object.fromEntries(rows.map((r) => [r.shop_id, r]));
}

/** Simpan biaya iklan TikTok satu hari. */
export async function simpanIklanTiktok(shopId, hari, biaya, catatan = null) {
  await q(`
    INSERT INTO tiktok_ad_spend (shop_id, day, biaya, catatan, diubah_at)
    VALUES ($1,$2,$3,$4, now())
    ON CONFLICT (shop_id, day) DO UPDATE
      SET biaya = EXCLUDED.biaya, catatan = EXCLUDED.catatan, diubah_at = now()`,
    [String(shopId), hari, Number(biaya) || 0, catatan]);
}

export async function daftarIklanTiktok(shopId, { hari = 60 } = {}) {
  return q(`
    SELECT day, biaya, catatan FROM tiktok_ad_spend
     WHERE shop_id = $1 AND day >= (now() AT TIME ZONE 'Asia/Jakarta')::date - $2::int
     ORDER BY day DESC`, [String(shopId), hari]);
}
