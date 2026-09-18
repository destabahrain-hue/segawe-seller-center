import { q, one } from './db';
import { PPN_IKLAN as tarifPpn } from './report';

/**
 * ── Laporan keuangan mingguan per toko ──
 *
 * Mengikuti metodologi laporan bulanan yang sudah dipakai, bukan cara
 * dashboard. Tiga hal yang membedakannya, dan ketiganya disengaja:
 *
 *  1. Periode berdasarkan TANGGAL DANA DILEPAS, bukan tanggal pesanan.
 *     Pesanan yang dananya belum cair belum masuk laporan mana pun.
 *  2. Penjualan = uang yang benar-benar diterima (escrow), bukan nilai
 *     yang dibayar pembeli.
 *  3. Biaya iklan sudah termasuk PPN 11% dari pengeluaran kotor.
 *
 * Minggu dimulai Senin, mengikuti waktu Jakarta.
 */

// Tarif diambil dari lib/report.js supaya seluruh laporan memakai angka
// yang sama — dulu ditulis dua kali dan bisa berbeda tanpa disadari.
export const PPN_IKLAN = 0.11;   // hanya untuk teks di layar

/** Kunci minggu (Senin) di zona Jakarta. */
const SENIN = `date_trunc('week', (e.release_at AT TIME ZONE 'Asia/Jakarta'))`;

/**
 * Ringkasan per toko untuk satu minggu.
 *
 * HPP memakai tarif yang berlaku pada TANGGAL PESANAN — bukan tanggal
 * pencairan — karena itulah biaya barangnya saat terjual.
 */
export async function ringkasMinggu(seninYmd) {
  const rows = await q(`
    WITH baris AS (
      SELECT o.shop_id, s.shop_name, o.id AS order_id,
             -- escrow_bersih = sebelum dipotong isi saldo iklan. Dialiaskan
             -- ke nama lama supaya seluruh SUM(b.escrow_amount) di bawah ikut
             -- terkoreksi tanpa perlu disentuh.
             e.escrow_bersih AS escrow_amount,
             SUM(oi.qty * oi.price) AS subtotal
      FROM order_escrow e
      JOIN orders o ON o.id = e.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN shops s ON s.shop_id = o.shop_id
      WHERE e.release_at IS NOT NULL
        AND ${SENIN} = $1::date
        AND COALESCE(e.escrow_amount,0) > 0
      GROUP BY o.shop_id, s.shop_name, o.id, e.escrow_bersih
    ),
    hpp AS (
      /**
       * HPP yang menguraikan PAKET ke komponennya.
       *
       * Sebelumnya blok ini memanggil hpp_pada() langsung ke master SKU.
       * Untuk SKU ber-kind='paket' itu selalu mengembalikan NOL, karena
       * HPP paket memang TIDAK PERNAH diinput manual — dijumlah dari
       * komponen. Akibatnya paket bundling terbaca bermodal Rp 0 dan
       * laba terlihat jauh lebih besar dari kenyataan. Pada Agustus 2026
       * itu Rp 469 juta HPP yang hilang dari satu bulan saja.
       *
       * Penautan SKU juga lewat DUA jalur terpisah (model_sku dan
       * item_sku), bukan satu COALESCE. Dengan satu COALESCE, baris yang
       * model_sku-nya terisi tapi tidak tertaut tidak pernah mencoba
       * item_sku, dan SKU-nya hilang begitu saja.
       *
       * Keduanya menyalin lib/report.js, yang sudah benar sejak awal.
       */
      WITH dasar AS (
        SELECT o.id AS order_id, o.shop_id, o.created_time,
               oi.id AS oi_id, oi.qty,
               NULLIF(TRIM(oi.model_sku),'') AS model_sku,
               NULLIF(TRIM(oi.item_sku),'')  AS item_sku
        FROM order_escrow e
        JOIN orders o ON o.id = e.order_id
        JOIN order_items oi ON oi.order_id = o.id
        WHERE e.release_at IS NOT NULL AND ${SENIN} = $1::date
          AND COALESCE(e.escrow_amount,0) > 0
      ),
      tertaut AS (
        SELECT d.*, COALESCE(mm.master_sku_id, mi.master_sku_id) AS msku
        FROM dasar d
        LEFT JOIN sku_mapping mm ON mm.shop_id = d.shop_id AND mm.shop_sku = d.model_sku
        LEFT JOIN sku_mapping mi ON mi.shop_id = d.shop_id AND mi.shop_sku = d.item_sku
      ),
      daun AS (
        SELECT t.order_id, t.created_time, t.oi_id, t.msku,
               COALESCE(c.child_id, t.msku) AS daun_id,
               t.qty * COALESCE(c.qty, 1)   AS daun_qty
        FROM tertaut t
        LEFT JOIN master_sku ms ON ms.id = t.msku
        LEFT JOIN master_sku_component c ON c.parent_id = ms.id AND ms.kind = 'paket'
      )
      SELECT order_id,
             SUM(daun_qty * hpp_pada(daun_id,
                   (created_time AT TIME ZONE 'Asia/Jakarta')::date)) AS hpp,
             -- Penjaga dihitung per BARIS PESANAN (oi_id), bukan per daun,
             -- supaya satu paket tak tertaut tidak terhitung berkali-kali.
             COUNT(DISTINCT oi_id) FILTER (WHERE daun_id IS NULL) AS tanpa_hpp
      FROM daun
      GROUP BY order_id
    ),
    iklan AS (
      SELECT shop_id, COALESCE(SUM(expense),0) AS kotor
      FROM ad_spend
      WHERE day >= $1::date AND day < $1::date + 7
      GROUP BY shop_id
    )
    SELECT b.shop_id, MIN(b.shop_name) AS shop_name,
           COUNT(DISTINCT b.order_id)::int AS pesanan,
           SUM(b.escrow_amount)            AS penjualan,
           COALESCE(SUM(h.hpp), 0)         AS hpp,
           COALESCE(SUM(h.tanpa_hpp), 0)::int AS baris_tanpa_hpp,
           COALESCE(MAX(i.kotor), 0)       AS iklan_kotor
    FROM baris b
    LEFT JOIN hpp   h ON h.order_id = b.order_id
    LEFT JOIN iklan i ON i.shop_id  = b.shop_id
    GROUP BY b.shop_id
    ORDER BY SUM(b.escrow_amount) DESC`, [seninYmd]);

  const toko = rows.map((r) => {
    const penjualan = Number(r.penjualan) || 0;
    const hpp = Number(r.hpp) || 0;
    const iklanKotor = Math.abs(Number(r.iklan_kotor) || 0);
    const ppn = iklanKotor * tarifPpn();
    const iklan = iklanKotor + ppn;          // bonus belum tersedia lewat API
    const labaKotor = penjualan - hpp;
    const laba = labaKotor - iklan;
    return {
      shopId: String(r.shop_id),
      nama: r.shop_name || `Toko ${r.shop_id}`,
      pesanan: Number(r.pesanan) || 0,
      penjualan, hpp, labaKotor,
      iklanKotor, ppn, iklan, laba,
      marginKotor: penjualan ? (labaKotor / penjualan) * 100 : 0,
      marginBersih: penjualan ? (laba / penjualan) * 100 : 0,
      barisTanpaHpp: Number(r.baris_tanpa_hpp) || 0,
    };
  });

  const total = toko.reduce((a, t) => ({
    pesanan: a.pesanan + t.pesanan, penjualan: a.penjualan + t.penjualan,
    hpp: a.hpp + t.hpp, labaKotor: a.labaKotor + t.labaKotor,
    iklanKotor: a.iklanKotor + t.iklanKotor, ppn: a.ppn + t.ppn,
    iklan: a.iklan + t.iklan, laba: a.laba + t.laba,
    barisTanpaHpp: a.barisTanpaHpp + t.barisTanpaHpp,
  }), { pesanan: 0, penjualan: 0, hpp: 0, labaKotor: 0, iklanKotor: 0, ppn: 0, iklan: 0, laba: 0, barisTanpaHpp: 0 });
  total.marginKotor = total.penjualan ? (total.labaKotor / total.penjualan) * 100 : 0;
  total.marginBersih = total.penjualan ? (total.laba / total.penjualan) * 100 : 0;

  return { toko, total };
}

/** Rekap per SKU untuk satu minggu, boleh disaring per toko. */
export async function perSkuMinggu(seninYmd, shopId = null) {
  return q(`
    WITH baris AS (
      SELECT o.shop_id, o.id AS order_id, e.escrow_bersih AS escrow_amount,
             oi.qty, oi.price, oi.item_name,
             COALESCE(ms.code, NULLIF(TRIM(oi.model_sku),''),
                      NULLIF(TRIM(oi.item_sku),''), '(tanpa SKU)') AS sku,
             ms.id IS NOT NULL AS tertaut,
             h.hpp,
             SUM(oi.qty * oi.price) OVER (PARTITION BY o.id) AS subtotal_pesanan
      FROM order_escrow e
      JOIN orders o ON o.id = e.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN sku_mapping sm ON sm.shop_id = o.shop_id
            AND sm.shop_sku = COALESCE(NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),''))
      LEFT JOIN master_sku ms ON ms.id = sm.master_sku_id
      /**
       * HPP paket dijumlah dari komponennya.
       *
       * Di sini paket TIDAK diuraikan jadi baris komponen seperti di
       * ringkasan — barisnya harus tetap atas nama paketnya, karena
       * inilah tabel yang dibaca orang untuk tahu SKU mana yang laku.
       * Yang diuraikan hanya perhitungan modalnya.
       *
       * Tanpa ini, hpp_pada() atas SKU ber-kind='paket' mengembalikan
       * nol dan paket bundling tampil bermargin 100%.
       *
       * hpp_pada(): berlaku pada tanggal itu, atau catatan paling awal
       * kalau pesanannya lebih tua dari catatan HPP pertama.
       */
      LEFT JOIN LATERAL (
        SELECT CASE WHEN ms.kind = 'paket' THEN (
                 SELECT SUM(c.qty * hpp_pada(c.child_id,
                          (o.created_time AT TIME ZONE 'Asia/Jakarta')::date))
                 FROM master_sku_component c WHERE c.parent_id = ms.id)
               ELSE hpp_pada(sm.master_sku_id,
                        (o.created_time AT TIME ZONE 'Asia/Jakarta')::date)
          END AS hpp) h ON TRUE
      WHERE e.release_at IS NOT NULL AND ${SENIN} = $1::date
        AND COALESCE(e.escrow_amount,0) > 0
        AND ($2::bigint IS NULL OR o.shop_id = $2)
    )
    SELECT sku,
           MIN(item_name)                AS nama,
           BOOL_OR(tertaut)              AS tertaut,
           SUM(qty)::int                 AS qty,
           -- Uang masuk dibagi PROPORSIONAL menurut nilai baris, bukan rata.
           SUM(escrow_amount * CASE WHEN subtotal_pesanan > 0
                 THEN (qty * price) / subtotal_pesanan ELSE 0 END) AS uang_masuk,
           SUM(qty * COALESCE(hpp,0))    AS hpp,
           BOOL_OR(hpp IS NULL)          AS ada_tanpa_hpp
    FROM baris
    GROUP BY sku
    ORDER BY 5 DESC
    LIMIT 300`, [seninYmd, shopId]);
}

/** Minggu-minggu yang punya data, terbaru dulu. */
export async function daftarMinggu(batas = 26) {
  return q(`
    SELECT to_char(${SENIN}, 'YYYY-MM-DD') AS senin,
           COUNT(DISTINCT e.order_id)::int AS pesanan,
           SUM(e.escrow_bersih)            AS penjualan
    FROM order_escrow e
    WHERE e.release_at IS NOT NULL AND COALESCE(e.escrow_amount,0) > 0
    GROUP BY 1 ORDER BY 1 DESC LIMIT $1`, [batas]);
}

/** Berapa pesanan yang belum punya tanggal pencairan — untuk kejujuran angka. */
export async function belumCair() {
  return one(`
    SELECT COUNT(*)::int AS jumlah,
           SUM(CASE WHEN e.order_id IS NULL THEN 1 ELSE 0 END)::int AS tanpa_escrow
    FROM orders o
    LEFT JOIN order_escrow e ON e.order_id = o.id
    WHERE COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')
      AND (e.order_id IS NULL OR e.release_at IS NULL)`);
}
