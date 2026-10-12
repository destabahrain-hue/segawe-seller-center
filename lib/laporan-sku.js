import { q } from './db';
import { PPN_IKLAN } from './report';

/**
 * ── Laporan SKU ──
 *
 * Satu baris per KODE (Master SKU; kalau belum tertaut, SKU toko apa adanya),
 * dijumlah lintas toko dan lintas marketplace — kecuali disaring.
 *
 * Basis waktu: TANGGAL PESANAN DIBUAT (sama dengan Laporan Toko), bukan
 * tanggal cair. Pesanan belum dibayar tidak dihitung; pesanan batal dihitung
 * terpisah sebagai "batal" supaya tingkat pembatalan per SKU kelihatan.
 *
 * TAYANGAN & KLIK yang tersedia di sini adalah TAYANGAN IKLAN — dari laporan
 * iklan Shopee per produk (impression & clicks, endpoint yang terbukti).
 * Kunjungan halaman produk secara organik (angka "Dilihat" di Seller Centre)
 * tidak tersedia di API yang dipakai NSC, jadi tidak ditampilkan supaya
 * tidak ada angka karangan. Iklan TikTok belum per produk (diisi manual per
 * toko), jadi kolom iklan hanya berisi iklan Shopee.
 *
 * Biaya, tayangan, dan klik iklan sebuah item dibagi ke kode-kode yang
 * terjual di bawah item itu MENURUT PORSI OMZET — cara yang sama dengan
 * iklanPerSku() di lib/report.js (satu item bisa terjual sebagai beberapa
 * Master SKU, mis. alat + beberapa jenis strip).
 */

export const URUT_SKU = [
  ['omzet',    'Omzet'],
  ['terjual',  'Terjual (pcs)'],
  ['pesanan',  'Pesanan'],
  ['laba',     'Laba kotor'],
  ['iklan',    'Biaya iklan'],
  ['tayangan', 'Tayangan iklan'],
  ['klik',     'Klik iklan'],
  ['batal',    'Batal'],
];

/**
 * toko: null | id toko Shopee (angka) | 'tt-<id>' untuk TikTok.
 * mp:   null | 'shopee' | 'tiktok'.
 */
export async function laporanSku({ dari, sampai, toko = null, mp = null }) {
  const tokoTt = String(toko || '').startsWith('tt-') ? String(toko).slice(3) : null;
  const tokoSp = toko && !tokoTt ? String(toko) : null;
  const pakaiSp = !tokoTt && mp !== 'tiktok';
  const pakaiTt = !tokoSp && mp !== 'shopee';

  const bagian = [];
  if (pakaiSp) {
    bagian.push(`
      SELECT 'shopee' AS mp, o.shop_id::text AS shop_id, o.id::text AS oid,
             o.status IN ('CANCELLED') AS batal,
             oi.item_id, oi.qty::numeric AS qty, (oi.qty * oi.price)::numeric AS nilai,
             oi.image_url AS gambar, oi.item_name AS nama,
             COALESCE(mm.master_sku_id, mi.master_sku_id) AS msid,
             COALESCE(NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),''), '(tanpa SKU)') AS sku_toko,
             (o.created_time AT TIME ZONE 'Asia/Jakarta')::date AS tgl
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN sku_mapping mm ON mm.shop_id = o.shop_id AND mm.shop_sku = oi.model_sku
        LEFT JOIN sku_mapping mi ON mi.shop_id = o.shop_id AND mi.shop_sku = oi.item_sku
       WHERE o.created_time >= $1 AND o.created_time < $2
         AND COALESCE(o.status,'') <> 'UNPAID'
         AND ($3::text IS NULL OR o.shop_id::text = $3)`);
  }
  if (pakaiTt) {
    // TikTok: satu baris per UNIT, jadi qty = 1 per baris.
    bagian.push(`
      SELECT 'tiktok' AS mp, t.shop_id AS shop_id, t.order_id AS oid,
             t.status = 'CANCELLED' AS batal,
             NULL::bigint AS item_id, 1::numeric AS qty, i.sale_price::numeric AS nilai,
             i.sku_image AS gambar, i.product_name AS nama,
             m.master_sku_id AS msid,
             COALESCE(NULLIF(TRIM(i.seller_sku),''), '(tanpa SKU)') AS sku_toko,
             (t.create_time AT TIME ZONE 'Asia/Jakarta')::date AS tgl
        FROM tiktok_orders t
        JOIN tiktok_order_items i ON i.order_id = t.order_id
        LEFT JOIN tiktok_sku_mapping m ON m.shop_id = i.shop_id AND m.seller_sku = i.seller_sku
       WHERE t.create_time >= $1 AND t.create_time < $2
         AND t.status NOT IN ('UNPAID','ON_HOLD')
         AND ($4::text IS NULL OR t.shop_id = $4)`);
  }
  if (!bagian.length) return { baris: [], iklanSisa: 0 };

  const rows = await q(`
    WITH -- Semua parameter disebut sekali di sini supaya kueri tetap sah
         -- walau salah satu marketplace tidak ikut (parameter tak terpakai
         -- ditolak Postgres).
         _p AS (SELECT $1::timestamptz, $2::timestamptz, $3::text, $4::text),
         semua AS (${bagian.join(' UNION ALL ')}),
    baris AS (
      SELECT s.*, COALESCE(ms.code, s.sku_toko) AS code, ms.name AS nama_master, ms.kind,
             -- HPP per unit pada TANGGAL PESANAN; paket = jumlah komponennya.
             CASE WHEN ms.id IS NULL THEN NULL
                  WHEN ms.kind = 'paket' THEN (
                    SELECT SUM(c.qty * hpp_pada(c.child_id, s.tgl))
                      FROM master_sku_component c WHERE c.parent_id = ms.id)
                  ELSE hpp_pada(ms.id, s.tgl) END AS hpp_unit
        FROM semua s
        LEFT JOIN master_sku ms ON ms.id = s.msid
    )
    SELECT code,
           MAX(nama_master)                                         AS nama_master,
           MIN(nama)                                                AS nama_produk,
           (ARRAY_AGG(gambar) FILTER (WHERE gambar IS NOT NULL))[1] AS gambar,
           BOOL_OR(msid IS NOT NULL)                                AS tertaut,
           MAX(kind)                                                AS kind,
           COALESCE(SUM(qty)   FILTER (WHERE NOT batal), 0)          AS terjual,
           COUNT(DISTINCT mp || oid) FILTER (WHERE NOT batal)       AS pesanan,
           COALESCE(SUM(nilai) FILTER (WHERE NOT batal), 0)          AS omzet,
           COALESCE(SUM(qty * hpp_unit) FILTER (WHERE NOT batal), 0) AS hpp,
           BOOL_OR(hpp_unit IS NULL OR hpp_unit = 0)
             FILTER (WHERE NOT batal)                               AS ada_tanpa_hpp,
           COALESCE(SUM(qty)   FILTER (WHERE batal), 0)              AS batal_pcs,
           COUNT(DISTINCT mp || oid) FILTER (WHERE batal)           AS batal_pesanan,
           COALESCE(SUM(qty)   FILTER (WHERE NOT batal AND mp = 'shopee'), 0) AS pcs_shopee,
           COALESCE(SUM(qty)   FILTER (WHERE NOT batal AND mp = 'tiktok'), 0) AS pcs_tiktok,
           COUNT(DISTINCT mp || shop_id) FILTER (WHERE NOT batal)   AS toko
      FROM baris
     GROUP BY code`, [dari, sampai, tokoSp, tokoTt]);

  const iklan = pakaiSp ? await iklanPerKode({ dari, sampai, toko: tokoSp }) : { peta: {}, sisa: 0 };
  const ppn = 1 + PPN_IKLAN();

  const baris = rows.map((r) => {
    const a = iklan.peta[r.code] || {};
    const omzet = Number(r.omzet) || 0;
    const hpp = Number(r.hpp) || 0;
    const biayaIklan = (a.expense || 0) * ppn;
    const terjual = Number(r.terjual) || 0;
    const pesanan = Number(r.pesanan) || 0;
    const batalPesanan = Number(r.batal_pesanan) || 0;
    const tayangan = a.impression || 0;
    const klik = a.clicks || 0;
    const labaKotor = omzet - hpp;
    const laba = labaKotor - biayaIklan;
    return {
      code: r.code,
      nama: r.nama_master || r.nama_produk || r.code,
      namaProduk: r.nama_produk,
      gambar: r.gambar,
      tertaut: !!r.tertaut,
      paket: r.kind === 'paket',
      terjual, pesanan, omzet, hpp, labaKotor, biayaIklan, laba,
      hargaRata: terjual ? omzet / terjual : 0,
      margin: omzet ? laba / omzet : 0,
      tanpaHpp: !!r.ada_tanpa_hpp,
      batal: Number(r.batal_pcs) || 0,
      tingkatBatal: (pesanan + batalPesanan) ? batalPesanan / (pesanan + batalPesanan) : 0,
      pcsShopee: Number(r.pcs_shopee) || 0,
      pcsTiktok: Number(r.pcs_tiktok) || 0,
      toko: Number(r.toko) || 0,
      tayangan, klik,
      ctr: tayangan ? klik / tayangan : 0,
      roas: biayaIklan ? omzet / biayaIklan : 0,
      iklanPerPcs: terjual ? biayaIklan / terjual : 0,
    };
  });
  return { baris, iklanSisa: iklan.sisa * ppn };
}

/**
 * Iklan Shopee (biaya, tayangan, klik) per KODE, dibagi menurut porsi omzet
 * kode di bawah item yang sama. Biaya item yang tidak terjual sama sekali di
 * periode ini tidak punya kode tujuan — dikembalikan sebagai `sisa`.
 */
async function iklanPerKode({ dari, sampai, toko = null }) {
  const rows = await q(`
    WITH berkode AS (
      SELECT o.shop_id, oi.item_id,
             COALESCE(ms.code, NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),''),
                      '(tanpa SKU)') AS code,
             SUM(oi.qty * oi.price) AS omzet
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN sku_mapping mm ON mm.shop_id = o.shop_id AND mm.shop_sku = oi.model_sku
        LEFT JOIN sku_mapping mi ON mi.shop_id = o.shop_id AND mi.shop_sku = oi.item_sku
        LEFT JOIN master_sku ms ON ms.id = COALESCE(mm.master_sku_id, mi.master_sku_id)
       WHERE o.created_time >= $1 AND o.created_time < $2
         AND COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')
         AND oi.item_id IS NOT NULL
         AND ($3::text IS NULL OR o.shop_id::text = $3)
       GROUP BY 1, 2, 3
    ),
    bobot AS (
      SELECT shop_id, item_id, code,
             COALESCE(
               NULLIF(omzet, 0) / NULLIF(SUM(omzet) OVER (PARTITION BY shop_id, item_id), 0),
               1.0 / COUNT(*) OVER (PARTITION BY shop_id, item_id)) AS w
        FROM berkode
    ),
    iklan AS (
      SELECT shop_id, item_id,
             SUM(ABS(expense)) AS expense, SUM(impression) AS impression, SUM(clicks) AS clicks
        FROM ad_spend_item
       WHERE day >= ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
         AND day <= (($2::timestamptz AT TIME ZONE 'Asia/Jakarta') - interval '1 second')::date
         AND ($3::text IS NULL OR shop_id::text = $3)
       GROUP BY shop_id, item_id
    )
    SELECT b.code,
           SUM(i.expense * b.w)    AS expense,
           SUM(i.impression * b.w) AS impression,
           SUM(i.clicks * b.w)     AS clicks,
           NULL::numeric           AS sisa
      FROM iklan i JOIN bobot b ON b.shop_id = i.shop_id AND b.item_id = i.item_id
     GROUP BY b.code
    UNION ALL
    SELECT NULL, NULL, NULL, NULL, COALESCE(SUM(i.expense), 0)
      FROM iklan i
     WHERE NOT EXISTS (SELECT 1 FROM bobot b WHERE b.shop_id = i.shop_id AND b.item_id = i.item_id)`,
    [dari, sampai, toko]);

  const peta = {};
  let sisa = 0;
  for (const r of rows) {
    if (r.code === null) { sisa = Number(r.sisa) || 0; continue; }
    peta[r.code] = {
      expense: Number(r.expense) || 0,
      impression: Math.round(Number(r.impression) || 0),
      clicks: Math.round(Number(r.clicks) || 0),
    };
  }
  return { peta, sisa };
}
