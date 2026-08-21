import { q, one } from './db';

const FEE_CADANGAN = () => Number(process.env.EST_PLATFORM_FEE_PCT || 14) / 100;

/**
 * PPN atas belanja iklan Shopee, 11%.
 *
 * Yang ditagihkan Shopee lewat API hanya pengeluaran pokoknya; PPN-nya
 * tidak ikut. Kalau tidak ditambahkan, biaya iklan tercatat lebih rendah
 * dari yang benar-benar keluar — dan laba terlihat lebih tinggi.
 *
 * Dipakai seluruh laporan (Dashboard, Laporan Toko, Keuangan, Mingguan)
 * supaya angkanya seragam, bukan berbeda-beda antar halaman.
 */
export const PPN_IKLAN = () => Number(process.env.PPN_IKLAN_PCT || 11) / 100;

/**
 * Tarif potongan platform yang DIUKUR dari toko sendiri.
 *
 * Sebelumnya biaya platform dihitung dari commission_fee + service_fee saja,
 * padahal Shopee juga memotong biaya transaksi, biaya program, dan lainnya —
 * jadi biayanya selalu tercatat lebih rendah dari kenyataan, dan laba
 * terlihat lebih tinggi.
 *
 * Sekarang untuk pesanan yang dananya SUDAH CAIR, biaya dihitung sebagai
 * (omzet − dana diterima). Itu selisih nyata, otomatis mencakup semua
 * potongan tanpa perlu menebak namanya. Dari situ pula tarif rata-rata per
 * toko dihitung, lalu dipakai untuk menaksir pesanan yang belum cair.
 *
 * EST_PLATFORM_FEE_PCT turun fungsi jadi cadangan: hanya dipakai untuk toko
 * yang belum punya satu pun pesanan cair.
 */
export async function tarifPlatform({ hari = 180 } = {}) {
  const rows = await q(`
    WITH per_pesanan AS (
      SELECT o.id, o.shop_id, SUM(oi.qty * oi.price) AS omzet
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_time >= now() - make_interval(days => $1)
        AND COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')
      GROUP BY o.id, o.shop_id
    )
    SELECT p.shop_id,
           SUM(p.omzet)                       AS omzet,
           SUM(COALESCE(e.escrow_amount,0))   AS diterima,
           COUNT(*)::int                      AS pesanan
    FROM per_pesanan p
    JOIN order_escrow e ON e.order_id = p.id
    WHERE COALESCE(e.escrow_amount,0) > 0
    GROUP BY p.shop_id`, [hari]);

  const perToko = new Map();
  let omzetAll = 0, diterimaAll = 0, pesananAll = 0;
  for (const r of rows) {
    const omzet = Number(r.omzet) || 0;
    const diterima = Number(r.diterima) || 0;
    omzetAll += omzet; diterimaAll += diterima; pesananAll += Number(r.pesanan) || 0;
    // Butuh sampel yang cukup — 5 pesanan cair sudah lebih dipercaya
    // daripada tebakan 14% yang tidak diukur sama sekali.
    if (omzet > 0 && Number(r.pesanan) >= 5) {
      perToko.set(String(r.shop_id), Math.min(Math.max((omzet - diterima) / omzet, 0), 0.6));
    }
  }
  const global = omzetAll > 0 && pesananAll >= 5
    ? Math.min(Math.max((omzetAll - diterimaAll) / omzetAll, 0), 0.6)
    : null;

  return {
    perToko, global, cadangan: FEE_CADANGAN(), sampel: pesananAll,
    tarif(shopId) {
      return perToko.get(String(shopId)) ?? global ?? FEE_CADANGAN();
    },
    asal(shopId) {
      if (perToko.has(String(shopId))) return 'toko';
      if (global !== null) return 'gabungan';
      return 'cadangan';
    },
  };
}

/**
 * Inti perhitungan laba.
 *
 *   laba = omzet − HPP − biaya platform − iklan
 *
 * Biaya platform memakai angka NYATA dari escrow bila sudah tersedia.
 * Kalau belum (pesanan baru, dana belum dilepas Shopee) dipakai
 * persentase perkiraan dari EST_PLATFORM_FEE_PCT. Kolom `perkiraan`
 * memberi tahu berapa bagian yang masih tebakan.
 *
 * Bundling diuraikan satu tingkat: paket → komponen. HPP paket
 * TIDAK diinput manual, melainkan dijumlah dari komponennya.
 */
const CTE = `
WITH dasar AS (
  SELECT o.id, o.shop_id, o.created_time, o.order_sn,
         oi.id AS oi_id, oi.qty, oi.price, oi.item_sku, oi.model_sku, oi.item_name, oi.image_url
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.created_time >= $1 AND o.created_time < $2
    AND ($3::bigint IS NULL OR o.shop_id = $3)
    AND COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')
),
tertaut AS (
  SELECT d.*, COALESCE(mm.master_sku_id, mi.master_sku_id) AS msku
  FROM dasar d
  LEFT JOIN sku_mapping mm ON mm.shop_id = d.shop_id AND mm.shop_sku = d.model_sku
  LEFT JOIN sku_mapping mi ON mi.shop_id = d.shop_id AND mi.shop_sku = d.item_sku
),
daun AS (
  SELECT t.id, t.shop_id, t.created_time, t.oi_id,
         COALESCE(c.child_id, t.msku) AS daun_id,
         t.qty * COALESCE(c.qty, 1)   AS daun_qty
  FROM tertaut t
  LEFT JOIN master_sku ms ON ms.id = t.msku
  LEFT JOIN master_sku_component c ON c.parent_id = ms.id AND ms.kind = 'paket'
),
hpp_baris AS (
  SELECT d.id, d.shop_id, d.oi_id,
         -- hpp_pada() memakai catatan HPP yang berlaku pada tanggal itu, dan
         -- kalau belum ada, catatan paling awal — bukan nol. Lihat db/schema.sql.
         d.daun_qty * hpp_pada(d.daun_id, (d.created_time AT TIME ZONE 'Asia/Jakarta')::date) AS hpp,
         CASE WHEN d.daun_id IS NULL THEN 1 ELSE 0 END AS tak_tertaut
  FROM daun d
),
per_pesanan AS (
  SELECT t.id, t.shop_id,
         SUM(t.qty * t.price) AS omzet,
         SUM(t.qty)           AS unit
  FROM tertaut t GROUP BY t.id, t.shop_id
),
hpp_pesanan AS (
  SELECT id, SUM(hpp) AS hpp, MAX(tak_tertaut) AS ada_tak_tertaut
  FROM hpp_baris GROUP BY id
)
`;

export async function ringkasan({ dari, sampai, shopId = null }) {
  const rows = await q(`${CTE}
    SELECT
      p.shop_id,
      s.shop_name,
      COUNT(*)                                   AS pesanan,
      SUM(p.omzet)                               AS omzet,
      SUM(p.unit)                                AS unit,
      SUM(COALESCE(h.hpp,0))                     AS hpp,
      SUM(CASE WHEN COALESCE(e.escrow_amount,0) > 0 THEN p.omzet ELSE 0 END)          AS omzet_cair,
      SUM(CASE WHEN COALESCE(e.escrow_amount,0) > 0 THEN e.escrow_amount ELSE 0 END)   AS diterima,
      SUM(CASE WHEN COALESCE(e.escrow_amount,0) > 0 THEN 0 ELSE p.omzet END)           AS omzet_belum,
      SUM(CASE WHEN COALESCE(e.escrow_amount,0) > 0 THEN 0 ELSE 1 END)::int            AS perkiraan,
      SUM(CASE WHEN h.ada_tak_tertaut = 1 THEN 1 ELSE 0 END) AS tanpa_hpp
    FROM per_pesanan p
    LEFT JOIN hpp_pesanan h ON h.id = p.id
    LEFT JOIN order_escrow e ON e.order_id = p.id
    LEFT JOIN shops s ON s.shop_id = p.shop_id
    GROUP BY p.shop_id, s.shop_name
    ORDER BY SUM(p.omzet) DESC`,
    [dari, sampai, shopId]);

  const iklan = await q(
    `SELECT shop_id, COALESCE(SUM(expense),0) AS iklan
     FROM ad_spend
     -- ad_spend disimpan per TANGGAL, sedangkan rentang laporan berupa
     -- waktu dengan batas akhir eksklusif (awal hari berikutnya). Jadi
     -- hari terakhir yang ikut adalah sehari sebelum batas itu.
     --
     -- Salah sedikit di sini berakibat besar: memakai +1 membuat satu hari
     -- ekstra ikut terhitung (untuk laporan satu hari, dua kali lipat),
     -- sedangkan menghapusnya sama sekali membuang hari terakhirnya.
     WHERE day >= ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
       AND day <= (($2::timestamptz AT TIME ZONE 'Asia/Jakarta') - interval '1 second')::date
       AND ($3::bigint IS NULL OR shop_id = $3)
     GROUP BY shop_id`, [dari, sampai, shopId]);
  const peta = Object.fromEntries(iklan.map((r) => [String(r.shop_id), Number(r.iklan)]));

  const tarif = await tarifPlatform();

  const toko = rows.map((r) => {
    const omzet      = Number(r.omzet) || 0;
    const hpp        = Number(r.hpp) || 0;
    const omzetCair  = Number(r.omzet_cair) || 0;
    const diterima   = Number(r.diterima) || 0;
    const omzetBelum = Number(r.omzet_belum) || 0;
    // Pengeluaran pokok dari Shopee, lalu ditambah PPN.
    const adsPokok   = Math.abs(peta[String(r.shop_id)] || 0);
    const adsPpn     = adsPokok * PPN_IKLAN();
    const ads        = adsPokok + adsPpn;

    // Yang sudah cair: selisih nyata antara omzet dan uang yang masuk.
    // Yang belum: ditaksir memakai tarif toko ini sendiri.
    const biayaNyata     = Math.max(omzetCair - diterima, 0);
    const tarifDipakai   = tarif.tarif(r.shop_id);
    const biayaPerkiraan = omzetBelum * tarifDipakai;
    const biaya          = biayaNyata + biayaPerkiraan;

    const laba = omzet - hpp - biaya - ads;
    return {
      shopId: String(r.shop_id),
      nama: r.shop_name || `Toko ${r.shop_id}`,
      pesanan: Number(r.pesanan) || 0,
      unit: Number(r.unit) || 0,
      omzet, hpp, biaya, iklan: ads, iklanPokok: adsPokok, iklanPpn: adsPpn, laba,
      diterima, omzetCair, omzetBelum,
      tarif: tarifDipakai, tarifAsal: tarif.asal(r.shop_id),
      margin: omzet ? (laba / omzet) * 100 : 0,
      perkiraan: Number(r.perkiraan) || 0,
      tanpaHpp: Number(r.tanpa_hpp) || 0,
    };
  });

  const total = toko.reduce((a, t) => ({
    pesanan: a.pesanan + t.pesanan, unit: a.unit + t.unit,
    omzet: a.omzet + t.omzet, hpp: a.hpp + t.hpp, biaya: a.biaya + t.biaya,
    iklan: a.iklan + t.iklan, iklanPokok: a.iklanPokok + t.iklanPokok,
    iklanPpn: a.iklanPpn + t.iklanPpn, laba: a.laba + t.laba,
    diterima: a.diterima + t.diterima, omzetCair: a.omzetCair + t.omzetCair,
    omzetBelum: a.omzetBelum + t.omzetBelum,
    taksirTertimbang: a.taksirTertimbang + t.omzetBelum * t.tarif,
    perkiraan: a.perkiraan + t.perkiraan, tanpaHpp: a.tanpaHpp + t.tanpaHpp,
  }), { pesanan: 0, unit: 0, omzet: 0, hpp: 0, biaya: 0, iklan: 0,
        iklanPokok: 0, iklanPpn: 0, laba: 0,
        diterima: 0, omzetCair: 0, omzetBelum: 0, taksirTertimbang: 0,
        perkiraan: 0, tanpaHpp: 0 });
  total.margin = total.omzet ? (total.laba / total.omzet) * 100 : 0;
  // Dua angka berbeda, jangan tertukar:
  //  tarif       = tarif yang DIPAKAI untuk menaksir pesanan yang belum cair
  //  tarifEfektif= potongan gabungan sesungguhnya atas seluruh omzet
  total.tarif = total.omzetBelum ? total.taksirTertimbang / total.omzetBelum : (tarif.global ?? tarif.cadangan);
  total.tarifEfektif = total.omzet ? total.biaya / total.omzet : 0;
  total.sampel = tarif.sampel;

  return { toko, total };
}

/** Deret per jam (untuk halaman realtime) atau per hari (rentang panjang). */
export async function deret({ dari, sampai, satuan = 'hour', shopId = null }) {
  const rows = await q(`${CTE}
    SELECT date_trunc($4, p_all.created_time AT TIME ZONE 'Asia/Jakarta') AS titik,
           SUM(p_all.qty * p_all.price) AS omzet
    FROM tertaut p_all
    GROUP BY 1 ORDER BY 1`,
    [dari, sampai, shopId, satuan]);
  return rows.map((r) => ({ titik: r.titik, omzet: Number(r.omzet) || 0 }));
}

/** Laba per master SKU. */
/**
 * Pembatalan pada satu rentang waktu.
 *
 * Dua angka berbeda makna, sengaja tidak digabung:
 *
 *  - `batal`    — pesanan yang DIBATALKAN pada rentang ini, berapa pun
 *    tanggal pesanannya. Nilainya sudah keluar dari omzet, tapi perlu
 *    terlihat: omzet yang turun tanpa penjelasan lebih membingungkan
 *    daripada omzet yang turun dengan sebab.
 *
 *  - `menunggu` — pesanan IN_CANCEL yang dibuat pada rentang ini. MASIH
 *    dihitung sebagai omzet karena belum tentu jadi batal; keputusannya
 *    ada padamu. Ditampilkan sebagai peringatan, bukan dipotong diam-diam.
 */
export async function pembatalan({ dari, sampai, shopId = null }) {
  const nilai = 'COALESCE(SUM(oi.qty * oi.price), 0)';
  const [a, b] = await Promise.all([
    one(`SELECT COUNT(DISTINCT o.id)::int AS pesanan, ${nilai} AS nilai
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status = 'CANCELLED'
           AND o.cancelled_at >= $1 AND o.cancelled_at < $2
           AND ($3::bigint IS NULL OR o.shop_id = $3)`, [dari, sampai, shopId]),
    one(`SELECT COUNT(DISTINCT o.id)::int AS pesanan, ${nilai} AS nilai
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status = 'IN_CANCEL'
           AND o.created_time >= $1 AND o.created_time < $2
           AND ($3::bigint IS NULL OR o.shop_id = $3)`, [dari, sampai, shopId]),
  ]);
  return {
    batal:    { pesanan: Number(a?.pesanan || 0), nilai: Number(a?.nilai || 0) },
    menunggu: { pesanan: Number(b?.pesanan || 0), nilai: Number(b?.nilai || 0) },
  };
}

export async function perSku({ dari, sampai, shopId = null, limit = 20 }) {
  // LEFT JOIN, bukan JOIN. Dulu memakai JOIN dalam sehingga tabel ini
  // KOSONG selama Master SKU belum ditautkan — padahal penjualannya ada.
  // Sekarang SKU toko yang belum tertaut tetap tampil dan ditandai.
  return q(`${CTE}
    SELECT COALESCE(ms.code,
             NULLIF(TRIM(t.model_sku),''), NULLIF(TRIM(t.item_sku),''), '(tanpa SKU)') AS code,
           COALESCE(MIN(ms.name), MIN(t.item_name), '(tanpa nama)')                    AS name,
           MIN(t.image_url)                                                            AS gambar,
           BOOL_OR(ms.id IS NOT NULL)                                                  AS tertaut,
           SUM(t.qty)            AS unit,
           SUM(t.qty * t.price)  AS omzet
    FROM tertaut t
    LEFT JOIN master_sku ms ON ms.id = t.msku
    GROUP BY 1
    ORDER BY SUM(t.qty * t.price) DESC
    LIMIT ${Number(limit)}`, [dari, sampai, shopId]);
}

/** Saldo stok fisik per master SKU. */
export async function saldoGudang() {
  return q(`
    SELECT ms.id, ms.code, ms.name, ms.kind, ms.reorder_at,
           COALESCE(SUM(CASE WHEN sm.direction = 'in'  THEN sm.qty
                             WHEN sm.direction = 'out' THEN -sm.qty
                             ELSE sm.qty END), 0) AS saldo,
           COALESCE(SUM(CASE WHEN sm.direction = 'in'  THEN sm.qty ELSE 0 END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN sm.direction = 'out' THEN sm.qty ELSE 0 END), 0) AS keluar,
           (SELECT h.hpp FROM master_sku_hpp h
             WHERE h.master_sku_id = ms.id ORDER BY h.effective_from DESC LIMIT 1) AS hpp
    FROM master_sku ms
    LEFT JOIN stock_moves sm ON sm.master_sku_id = ms.id
    GROUP BY ms.id
    ORDER BY ms.name`);
}
