import { q } from './db';

/**
 * Status tampilan diturunkan dari status Shopee + total stok,
 * karena Shopee tidak punya status "Sold Out" — itu produk NORMAL
 * yang stoknya nol.
 */
export const TAB = [
  { key: 'live',    label: 'Aktif',     cond: `p.status = 'NORMAL' AND COALESCE(st.stok,0) > 0` },
  { key: 'habis',   label: 'Stok habis', cond: `p.status = 'NORMAL' AND COALESCE(st.stok,0) = 0` },
  { key: 'nonaktif',label: 'Nonaktif',  cond: `p.status IN ('UNLIST','DELISTED')` },
  { key: 'ditolak', label: 'Ditolak',   cond: `p.status IN ('BANNED','REVIEWING')` },
  { key: 'semua',   label: 'Semua',     cond: `TRUE` },
];
export const cariTab = (k) => TAB.find((t) => t.key === k) || TAB[0];

const DASAR = `
  FROM products p
  LEFT JOIN shops s ON s.shop_id = p.shop_id
  LEFT JOIN LATERAL (
    SELECT SUM(m.stock)::int AS stok, MIN(m.price) AS harga_min, MAX(m.price) AS harga_maks,
           COUNT(*)::int AS varian,
           MIN(NULLIF(TRIM(m.model_sku),'')) AS sku_varian
    FROM product_models m WHERE m.product_id = p.id
  ) st ON TRUE`;

export async function hitungTab({ shopId = null } = {}) {
  const bagian = TAB.filter((t) => t.key !== 'semua')
    .map((t) => `SUM(CASE WHEN ${t.cond} THEN 1 ELSE 0 END)::int AS ${t.key}`).join(', ');
  const rows = await q(
    `SELECT ${bagian}, COUNT(*)::int AS semua ${DASAR}
     ${shopId ? 'WHERE p.shop_id = $1' : ''}`, shopId ? [shopId] : []);
  return rows[0] || {};
}

function saringProduk({ tab = 'live', shopId = null, cari = null }) {
  const w = [cariTab(tab).cond];
  const p = [];
  if (shopId) { p.push(shopId); w.push(`p.shop_id = $${p.length}`); }
  if (cari) {
    p.push(`%${String(cari).trim()}%`);
    const n = p.length;
    // Cari nama produk, SKU induk, SKU varian, nomor item, dan kode Master SKU.
    w.push(`(p.name ILIKE $${n} OR p.item_sku ILIKE $${n} OR p.item_id::text ILIKE $${n}
             OR EXISTS (SELECT 1 FROM product_models m2 WHERE m2.product_id = p.id
                        AND (m2.model_sku ILIKE $${n} OR m2.model_name ILIKE $${n})))`);
  }
  return { where: w.join(' AND '), params: p };
}

/** Jumlah produk yang cocok — untuk penomoran halaman. */
export async function hitungBarisProduk(opsi = {}) {
  const { where, params } = saringProduk(opsi);
  const r = await q(`SELECT COUNT(*)::int AS n ${DASAR} WHERE ${where}`, params);
  return Number(r[0]?.n || 0);
}

export async function daftarProduk({ tab = 'live', shopId = null, cari = null,
                                     halaman = 1, perHalaman = 50 } = {}) {
  const { where, params: p } = saringProduk({ tab, shopId, cari });
  const per = [20, 50, 100, 200].includes(Number(perHalaman)) ? Number(perHalaman) : 50;
  const lewati = (Math.max(Number(halaman) || 1, 1) - 1) * per;
  return q(`
    SELECT p.*, s.shop_name, st.stok, st.harga_min, st.harga_maks, st.varian, st.sku_varian,
           ms.code AS master_code
    ${DASAR}
    LEFT JOIN sku_mapping sm ON sm.shop_id = p.shop_id
          AND sm.shop_sku = COALESCE(NULLIF(TRIM(st.sku_varian),''), NULLIF(TRIM(p.item_sku),''))
    LEFT JOIN master_sku ms ON ms.id = sm.master_sku_id
    WHERE ${where}
    ORDER BY s.shop_name NULLS LAST, p.name
    LIMIT ${per} OFFSET ${lewati}`, p);
}

/**
 * ── Analisis "belum disalin" ──
 * Tidak memanggil Shopee sama sekali. Cukup membandingkan katalog
 * yang sudah tersimpan: produk apa yang ada di satu toko tapi belum
 * ada di toko lain. Kuncinya Master SKU kalau sudah tertaut, kalau
 * belum jatuh ke SKU induk.
 */
const KUNCI = `COALESCE(ms.code, NULLIF(TRIM(p.item_sku),''), 'ITEM-' || p.item_id::text)`;

export async function petaSebaran() {
  return q(`
    WITH baris AS (
      SELECT p.shop_id, s.shop_name, ${KUNCI} AS kunci,
             MIN(p.name) AS nama, MIN(p.image_url) AS gambar,
             BOOL_OR(p.status = 'NORMAL') AS aktif
      ${DASAR}
      LEFT JOIN sku_mapping sm ON sm.shop_id = p.shop_id
            AND sm.shop_sku = COALESCE(NULLIF(TRIM(st.sku_varian),''), NULLIF(TRIM(p.item_sku),''))
      LEFT JOIN master_sku ms ON ms.id = sm.master_sku_id
      GROUP BY p.shop_id, s.shop_name, ${KUNCI}
    ), toko AS (SELECT COUNT(*)::int AS n FROM shops WHERE status = 'active')
    SELECT b.kunci,
           MIN(b.nama)   AS nama,
           MIN(b.gambar) AS gambar,
           COUNT(*)::int AS ada_di,
           (SELECT n FROM toko) - COUNT(*)::int AS belum_di,
           array_agg(DISTINCT b.shop_name ORDER BY b.shop_name) AS toko_ada
    FROM baris b
    GROUP BY b.kunci
    ORDER BY (SELECT n FROM toko) - COUNT(*) DESC, MIN(b.nama)
    LIMIT 400`);
}

/** Produk yang ada di toko sumber tapi belum ada di toko tujuan. */
export async function selisihToko(sumber, tujuan) {
  return q(`
    WITH kunciDi AS (
      SELECT p.shop_id, ${KUNCI} AS kunci, MIN(p.name) AS nama,
             MIN(p.item_id) AS item_id, MIN(p.image_url) AS gambar,
             MIN(st.harga_min) AS harga, SUM(COALESCE(st.stok,0))::int AS stok,
             MIN(p.status) AS status
      ${DASAR}
      LEFT JOIN sku_mapping sm ON sm.shop_id = p.shop_id
            AND sm.shop_sku = COALESCE(NULLIF(TRIM(st.sku_varian),''), NULLIF(TRIM(p.item_sku),''))
      LEFT JOIN master_sku ms ON ms.id = sm.master_sku_id
      WHERE p.shop_id = ANY($1::bigint[])
      GROUP BY p.shop_id, ${KUNCI}
    )
    SELECT a.kunci, a.nama, a.item_id, a.gambar, a.harga, a.stok, a.status
    FROM kunciDi a
    WHERE a.shop_id = $2
      AND NOT EXISTS (SELECT 1 FROM kunciDi b WHERE b.shop_id = $3 AND b.kunci = a.kunci)
    ORDER BY a.nama
    LIMIT 500`, [[sumber, tujuan], sumber, tujuan]);
}
