import { q, one } from './db';

/**
 * ── Analisa pelanggan ──
 *
 * Semua pengelompokan memakai pembeli_id (sidik satu arah dari username,
 * lihat lib/pembeli.js), bukan username. Jadi analisa tetap utuh walau data
 * pribadi pesanan lama sudah dibersihkan sesuai batas 90 hari Shopee.
 *
 * PEMBELI TIDAK DIGABUNG LINTAS TOKO. Username Shopee berbeda per toko
 * untuk orang yang sama, dan sidiknya memang memuat shop_id. Jadi "1.000
 * pelanggan" berarti 1.000 pasangan pembeli-toko, bukan 1.000 orang.
 *
 * Pesanan batal (CANCELLED) dan belum bayar (UNPAID) TIDAK dihitung sebagai
 * belanja, tapi yang batal tetap dihitung jumlahnya — justru itu gunanya
 * tab "Paling Sering Batal".
 *
 * TIDAK ADA KOTA / PROVINSI di sini. Dibuktikan lewat /api/diagnosa-alamat:
 * Shopee menyensor SELURUH isi recipient_address menjadi "****" untuk app
 * tanpa akses data sensitif — termasuk state dan region yang cuma provinsi.
 * Jadi sebaran wilayah tidak mungkin dibangun dari API ini, dan menampilkan
 * kolomnya hanya akan memenuhi layar dengan bintang.
 */

const SAH = `o.status NOT IN ('CANCELLED','UNPAID')`;

/** Potongan WHERE yang dipakai berulang. $1 dari, $2 sampai (eksklusif). */
function saring({ shopId = null } = {}, mulai = 3) {
  if (!shopId) return { sql: '', params: [] };
  return { sql: ` AND o.shop_id = $${mulai}`, params: [shopId] };
}

// Nama kolom hasil CTE 'per' — dipakai langsung di ORDER BY.
const KOLOM_URUT = { belanja: 'belanja', pesanan: 'pesanan', batal: 'batal', terakhir: 'terakhir' };

/**
 * Daftar pelanggan, berhalaman.
 *
 * tab: semua | teratas (20% belanja terbesar) | batal (>=2 batal atau rasio >=30%)
 */
export async function daftarPelanggan({
  dari, sampai, shopId = null, cari = '',
  tab = 'semua', urut = 'belanja', arah = 'desc', offset = 0, limit = 50,
} = {}) {
  const f = saring({ shopId });
  const dir = arah === 'asc' ? 'ASC' : 'DESC';
  const kata = String(cari || '').trim().toLowerCase();
  const pCari = kata ? [`%${kata}%`] : [];
  const iCari = 3 + f.params.length;

  const dasar = `
    WITH x AS (
      SELECT o.pembeli_id, o.shop_id, o.id, o.created_time,
             o.buyer_username,
             (o.status = 'CANCELLED') AS batal,
             CASE WHEN ${SAH} THEN COALESCE((SELECT SUM(oi.qty * oi.price)
                                               FROM order_items oi WHERE oi.order_id = o.id), 0)
                  ELSE 0 END AS belanja
        FROM orders o
       WHERE o.pembeli_id IS NOT NULL
         AND o.created_time >= $1 AND o.created_time < $2${f.sql}
         ${kata ? `AND lower(COALESCE(o.buyer_username,'')) LIKE $${iCari}` : ''}
    ),
    per AS (
      SELECT x.pembeli_id,
             MAX(x.buyer_username)                    AS username,
             COUNT(*)::int                             AS pesanan,
             COUNT(*) FILTER (WHERE x.batal)::int      AS batal,
             SUM(x.belanja)                            AS belanja,
             MIN(x.created_time)                       AS pertama,
             MAX(x.created_time)                       AS terakhir,
             COUNT(DISTINCT x.shop_id)::int            AS toko
        FROM x GROUP BY x.pembeli_id
    )`;
  const params = [dari, sampai, ...f.params, ...pCari];

  const tabSql = tab === 'batal'
    ? `WHERE batal >= 2 OR (pesanan > 0 AND batal::float / pesanan >= 0.3)`
    : '';

  // "Teratas" = 20% pelanggan dengan belanja terbesar dari hasil saringan.
  const teratas = tab === 'teratas';
  const rows = await q(`${dasar}
    , urut AS (
      SELECT per.*, NTILE(5) OVER (ORDER BY belanja DESC) AS kelompok FROM per
    )
    SELECT *, COUNT(*) OVER ()::int AS total_baris
      FROM urut ${teratas ? 'WHERE kelompok = 1' : tabSql}
     ORDER BY ${KOLOM_URUT[urut] || KOLOM_URUT.belanja} ${dir} NULLS LAST, pembeli_id
     LIMIT ${Math.max(Number(limit) || 50, 1)} OFFSET ${Math.max(Number(offset) || 0, 0)}`, params);

  const ringkas = await one(`${dasar}
    SELECT COUNT(*)::int                                   AS pelanggan,
           COALESCE(SUM(belanja), 0)                       AS belanja,
           COALESCE(SUM(pesanan), 0)::int                  AS pesanan,
           COALESCE(SUM(batal), 0)::int                    AS batal,
           COUNT(*) FILTER (WHERE pesanan - batal >= 2)::int AS berulang
      FROM per`, params);

  return {
    total: rows[0]?.total_baris || 0,
    baris: rows.map((r) => ({
      pembeli_id: r.pembeli_id, username: r.username,
      pesanan: r.pesanan, batal: r.batal, toko: r.toko,
      belanja: Number(r.belanja) || 0,
      rata: r.pesanan - r.batal > 0 ? Number(r.belanja) / (r.pesanan - r.batal) : 0,
      pertama: r.pertama, terakhir: r.terakhir,
    })),
    ringkas: {
      pelanggan: ringkas?.pelanggan || 0,
      belanja: Number(ringkas?.belanja) || 0,
      pesanan: ringkas?.pesanan || 0,
      batal: ringkas?.batal || 0,
      berulang: ringkas?.berulang || 0,
      rata: ringkas?.pelanggan ? Number(ringkas.belanja) / ringkas.pelanggan : 0,
    },
  };
}

/** Riwayat satu pelanggan: pesanan, SKU favorit, jeda antar pembelian. */
export async function detailPelanggan(pembeliId) {
  const pesanan = await q(`
    SELECT o.order_sn, s.shop_name AS toko, o.status, o.created_time, o.carrier,
           o.buyer_username,
           COALESCE((SELECT SUM(oi.qty * oi.price) FROM order_items oi WHERE oi.order_id = o.id), 0) AS nilai,
           (SELECT string_agg(COALESCE(NULLIF(TRIM(oi.model_sku),''), oi.item_sku, oi.item_name), ', ')
              FROM order_items oi WHERE oi.order_id = o.id) AS barang
      FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.pembeli_id = $1
     ORDER BY o.created_time DESC LIMIT 200`, [pembeliId]);

  const sku = await q(`
    SELECT COALESCE(ms.code, NULLIF(TRIM(oi.model_sku),''), oi.item_sku, '(tanpa SKU)') AS code,
           SUM(oi.qty)::int AS unit, SUM(oi.qty * oi.price) AS nilai
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN sku_mapping mm ON mm.shop_id = o.shop_id AND mm.shop_sku = NULLIF(TRIM(oi.model_sku),'')
      LEFT JOIN sku_mapping mi ON mi.shop_id = o.shop_id AND mi.shop_sku = NULLIF(TRIM(oi.item_sku),'')
      LEFT JOIN master_sku ms ON ms.id = COALESCE(mm.master_sku_id, mi.master_sku_id)
     WHERE o.pembeli_id = $1 AND ${SAH}
     GROUP BY 1 ORDER BY SUM(oi.qty * oi.price) DESC LIMIT 20`, [pembeliId]);

  const sah = pesanan.filter((x) => !['CANCELLED', 'UNPAID'].includes(x.status));
  const jeda = [];
  for (let i = 0; i < sah.length - 1; i++) {
    jeda.push((new Date(sah[i].created_time) - new Date(sah[i + 1].created_time)) / 86400000);
  }
  return {
    pesanan, sku,
    jedaRata: jeda.length ? jeda.reduce((a, b) => a + b, 0) / jeda.length : null,
    belanja: sah.reduce((a, x) => a + Number(x.nilai), 0),
  };
}

/**
 * Retensi: pembeli baru vs berulang per bulan, dan berapa persen yang
 * kembali dalam 30/60/90 hari sejak pembelian PERTAMA mereka.
 */
export async function retensi({ shopId = null, bulan = 12 } = {}) {
  // Saringan toko ditulis langsung supaya nomor parameternya jelas per
  // kueri — menggeser nomor dengan regex gampang salah dan sulit dibaca.
  const t1 = shopId ? ' AND o.shop_id = $2' : '';   // kueri per bulan: $1 = jumlah bulan
  const t2 = shopId ? ' AND o.shop_id = $1' : '';   // dua kueri lain tanpa parameter lain
  const p1 = shopId ? [Math.max(Number(bulan) || 12, 1), shopId] : [Math.max(Number(bulan) || 12, 1)];
  const p2 = shopId ? [shopId] : [];

  const perBulan = await q(`
    WITH p AS (
      SELECT o.pembeli_id, MIN(o.created_time) AS pertama
        FROM orders o WHERE o.pembeli_id IS NOT NULL AND ${SAH}${t1}
       GROUP BY 1
    ),
    b AS (
      SELECT DISTINCT o.pembeli_id,
             date_trunc('month', o.created_time AT TIME ZONE 'Asia/Jakarta') AS bulan
        FROM orders o WHERE o.pembeli_id IS NOT NULL AND ${SAH}${t1}
    )
    SELECT b.bulan,
           COUNT(*)::int AS aktif,
           COUNT(*) FILTER (WHERE date_trunc('month', p.pertama AT TIME ZONE 'Asia/Jakarta') = b.bulan)::int AS baru
      FROM b JOIN p ON p.pembeli_id = b.pembeli_id
     WHERE b.bulan >= date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') - make_interval(months => $1)
     GROUP BY b.bulan ORDER BY b.bulan`, p1);

  /**
   * Hanya pelanggan yang pesanan pertamanya lebih dari 90 hari lalu yang
   * ikut dihitung. Kalau tidak, pembeli minggu lalu (yang belum sempat
   * kembali) ikut membagi dan angka retensi terlihat jauh lebih buruk dari
   * kenyataan.
   */
  const balik = await one(`
    WITH p AS (
      SELECT o.pembeli_id, MIN(o.created_time) AS pertama
        FROM orders o WHERE o.pembeli_id IS NOT NULL AND ${SAH}${t2}
       GROUP BY 1
    ),
    ulang AS (
      SELECT p.pembeli_id, p.pertama,
             MIN(o.created_time) FILTER (WHERE o.created_time > p.pertama) AS kedua
        FROM p JOIN orders o ON o.pembeli_id = p.pembeli_id AND ${SAH}
       GROUP BY p.pembeli_id, p.pertama
    )
    SELECT COUNT(*)::int AS pelanggan,
           COUNT(*) FILTER (WHERE kedua IS NOT NULL)::int AS pernah_ulang,
           COUNT(*) FILTER (WHERE kedua <= pertama + interval '30 days')::int AS d30,
           COUNT(*) FILTER (WHERE kedua <= pertama + interval '60 days')::int AS d60,
           COUNT(*) FILTER (WHERE kedua <= pertama + interval '90 days')::int AS d90,
           AVG(EXTRACT(EPOCH FROM (kedua - pertama)) / 86400)
             FILTER (WHERE kedua IS NOT NULL) AS jeda_hari
      FROM ulang
     WHERE pertama < now() - interval '90 days'`, p2);

  /**
   * Segmen sengaja sederhana dan bisa dijelaskan ke tim: jumlah pesanan sah
   * dan kapan terakhir belanja. Segmen berbasis skor gabungan terlihat
   * pintar tapi sulit ditindaklanjuti.
   */
  const segmen = await one(`
    WITH p AS (
      SELECT o.pembeli_id, COUNT(*) FILTER (WHERE ${SAH})::int AS pesanan,
             MAX(o.created_time) FILTER (WHERE ${SAH}) AS terakhir,
             COALESCE(SUM(CASE WHEN ${SAH} THEN
               (SELECT SUM(oi.qty*oi.price) FROM order_items oi WHERE oi.order_id = o.id) END), 0) AS belanja
        FROM orders o WHERE o.pembeli_id IS NOT NULL${t2}
       GROUP BY 1
    )
    SELECT COUNT(*) FILTER (WHERE pesanan = 1)::int                            AS sekali,
           COUNT(*) FILTER (WHERE pesanan BETWEEN 2 AND 3)::int                AS berulang,
           COUNT(*) FILTER (WHERE pesanan >= 4)::int                           AS setia,
           COUNT(*) FILTER (WHERE terakhir < now() - interval '180 days')::int AS hilang,
           COALESCE(SUM(belanja) FILTER (WHERE pesanan >= 2), 0)               AS belanja_berulang,
           COALESCE(SUM(belanja), 0)                                           AS belanja_semua
      FROM p`, p2);

  return { perBulan, balik, segmen };
}

/** Distribusi kurir, plus rata-rata jeda Pack sampai barang dijemput. */
export async function kurir({ dari, sampai, shopId = null } = {}) {
  const f = saring({ shopId });
  return q(`
    SELECT COALESCE(o.carrier, '(tanpa kurir)') AS nama,
           COUNT(*)::int AS pesanan,
           COALESCE(SUM((SELECT SUM(oi.qty*oi.price) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS omzet,
           AVG(EXTRACT(EPOCH FROM (o.ship_time - o.ship_arranged_at)) / 3600)
             FILTER (WHERE o.ship_time IS NOT NULL AND o.ship_arranged_at IS NOT NULL
                       AND o.ship_time >= o.ship_arranged_at) AS jam_jemput
      FROM orders o
     WHERE ${SAH} AND o.created_time >= $1 AND o.created_time < $2${f.sql}
     GROUP BY 1 ORDER BY pesanan DESC`, [dari, sampai, ...f.params]);
}
