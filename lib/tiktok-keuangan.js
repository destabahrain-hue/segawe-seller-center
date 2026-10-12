import { q, one, log } from './db';
import { panggil, tokenHidupTiktok } from './tiktok';

/**
 * ── Keuangan TikTok dari transaksi statement ──
 *
 * DIBUKTIKAN lewat /api/tiktok/uji-endpoint (30 Sep 2026, HUMAIRA INDOSHOP):
 *   GET /finance/202309/statements/{statement_id}/statement_transactions
 *     params page_size + sort_field=order_create_time (wajib, sama seperti
 *     statements), balasan statement_transactions[] berisi SATU BARIS PER
 *     TRANSAKSI dengan order_id, type, settlement_amount, revenue_amount,
 *     fee_amount, dan puluhan rincian biaya — plus total_count.
 *
 * Inilah sumber yang sama dengan berkas income TikTok Seller Center yang
 * dulu diunggah manual di Beban Operasional: satu baris per pesanan yang
 * cair, dengan tanggal cair = statement_time. Jadi laporan keuangan TikTok
 * kini bisa dibangun dengan cara yang PERSIS sama dengan Shopee — uang yang
 * benar-benar masuk, dikurangi HPP pesanan-pesanan itu.
 *
 * SATU HAL YANG BELUM TERBUKTI: nama-nama `type`. Hanya jenis "pesanan"
 * yang pasti (baris yang punya order_id). Baris iklan GMV Max di berkas
 * income (Pembayaran GMV untuk Iklan TikTok, Biaya iklan GMV Max, dst.)
 * DIDUGA muncul sebagai baris ber-type lain tanpa order_id. Karena itu
 * pembagiannya tidak dipaku diam-diam: rincian per `type` selalu tampil di
 * layar dan di /api/tiktok/diagnosa-keuangan, supaya bisa dicocokkan dengan
 * berkas income bulan yang sama (Agustus 2026: iklan 37.740.000).
 */

const uang = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const waktu = (d) => (d ? new Date(Number(d) * 1000) : null);
const PAGE = 50;

/**
 * Pembagian jenis transaksi, SATU tempat untuk semua kueri.
 *   iklan   — type mengandung ADS / GMV / AD_ (bukan pesanan)
 *   pesanan — punya order_id
 *   lain    — sisanya (penyesuaian, kompensasi, dll.)
 */
export const JENIS_SQL = (t = 'x') => `
  CASE WHEN ${t}.tipe ~* '(ADS|GMV|(^|_)AD(_|$))' THEN 'iklan'
       WHEN COALESCE(${t}.order_id, '') <> '' THEN 'pesanan'
       ELSE 'lain' END`;

/**
 * Tarik transaksi untuk statement yang belum ditarik (atau yang masih baru,
 * karena statement beberapa hari terakhir bisa masih bertambah isinya).
 *
 * Penanda tuntas HANYA dipasang kalau jumlah yang terkumpul sama dengan
 * total_count dari TikTok. Pelajaran Shopee: penarikan yang melapor
 * "selesai" dengan 0 baris selama berbulan-bulan karena parameter yang
 * diterima tanpa protes tapi tidak bekerja. Di sini, kalau jumlahnya tidak
 * cocok, statement itu dicoba lagi pada putaran berikutnya dan galatnya
 * dicatat.
 */
export async function tarikTransaksiTiktok(shopId, { detik = 40 } = {}) {
  const t = await tokenHidupTiktok(shopId);
  const batasWaktu = Date.now() + detik * 1000;
  const antre = await q(`
    SELECT statement_id FROM tiktok_statements
     WHERE shop_id = $1
       AND (tx_ditarik_at IS NULL
            OR (statement_time > now() - interval '3 days'
                AND tx_ditarik_at < now() - interval '1 hour'))
     ORDER BY statement_time DESC NULLS LAST`, [String(shopId)]);

  let statement = 0, baris = 0, meleset = 0, galat = null, galatBeruntun = 0, dicoba = 0;
  for (const { statement_id: sid } of antre) {
    if (Date.now() > batasWaktu) break;
    /**
     * Galat satu statement TIDAK menghentikan yang lain, tapi tiga galat
     * berturut-turut berarti masalahnya sistematis (token, parameter,
     * scope) — berhenti dan laporkan pesannya, jangan menghabiskan batas
     * laju untuk 850 panggilan yang pasti gagal.
     */
    dicoba++;
    try {
    const path = `/finance/202309/statements/${sid}/statement_transactions`;
    let pageToken = null, total = null, kumpul = 0, putus = false;
    for (let i = 0; i < 200; i++) {
      if (Date.now() > batasWaktu) { putus = true; break; }
      const json = await panggil(path, {
        method: 'GET', token: t.access_token, shopCipher: t.shop_cipher,
        params: { page_size: PAGE, sort_field: 'order_create_time', sort_order: 'ASC',
                  ...(pageToken ? { page_token: pageToken } : {}) },
      });
      const d = json.data || {};
      if (total === null && d.total_count !== undefined) total = Number(d.total_count);
      for (const x of d.statement_transactions || []) {
        await q(`
          INSERT INTO tiktok_statement_tx (statement_id, tx_id, shop_id, statement_time,
            order_id, order_create_time, tipe, settlement_amount, revenue_amount, fee_amount,
            shipping_cost_amount, adjustment_amount, gross_sales_amount, net_sales_amount,
            platform_commission_amount, transaction_fee_amount, affiliate_commission_amount,
            affiliate_ads_commission_amount, seller_discount_amount, platform_discount_amount,
            customer_payment_amount, fetched_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now())
          ON CONFLICT (statement_id, tx_id) DO UPDATE SET
            tipe = EXCLUDED.tipe, order_id = EXCLUDED.order_id,
            settlement_amount = EXCLUDED.settlement_amount, revenue_amount = EXCLUDED.revenue_amount,
            fee_amount = EXCLUDED.fee_amount, shipping_cost_amount = EXCLUDED.shipping_cost_amount,
            adjustment_amount = EXCLUDED.adjustment_amount, fetched_at = now()`,
          [sid, String(x.id), String(shopId), waktu(d.statement_time),
           x.order_id || null, waktu(x.order_create_time), x.type || null,
           uang(x.settlement_amount), uang(x.revenue_amount), uang(x.fee_amount),
           uang(x.shipping_cost_amount), uang(x.adjustment_amount), uang(x.gross_sales_amount),
           uang(x.net_sales_amount), uang(x.platform_commission_amount),
           uang(x.transaction_fee_amount), uang(x.affiliate_commission_amount),
           uang(x.affiliate_ads_commission_amount), uang(x.seller_discount_amount),
           uang(x.platform_discount_amount), uang(x.customer_payment_amount)]);
        kumpul++;
      }
      pageToken = d.next_page_token || null;
      if (!pageToken) break;
    }
    if (putus) break;
    baris += kumpul;
    if (total !== null && kumpul !== total) {
      meleset++;
      await log('tiktok', `Transaksi statement ${sid}: terkumpul ${kumpul}, TikTok bilang ${total}`,
        { ok: false });
      continue;   // tidak ditandai tuntas — dicoba lagi putaran berikutnya
    }
    await q(`UPDATE tiktok_statements SET tx_ditarik_at = now(), tx_jumlah = $2
              WHERE statement_id = $1`, [sid, kumpul]);
    statement++;
    galatBeruntun = 0;
    } catch (e) {
      galat = galat || `${e.message}${e.kode ? ` (kode ${e.kode})` : ''} — statement ${sid}`;
      galatBeruntun++;
      await log('tiktok', `Transaksi statement ${sid} gagal: ${e.message}`, { ok: false });
      if (galatBeruntun >= 3) break;
    }
  }
  const sisa = await one(`SELECT COUNT(*)::int AS n FROM tiktok_statements
                           WHERE shop_id = $1 AND tx_ditarik_at IS NULL`, [String(shopId)]);
  return { antre: antre.length, dicoba, statement, baris, meleset, galat, sisa: sisa?.n || 0 };
}

/**
 * Satu pesanan bisa muncul di LEBIH DARI SATU statement — misalnya cair
 * dulu, lalu minggu depannya ada potongan refund atas pesanan yang sama.
 * Uangnya ikut di periode masing-masing (itu uang sungguhan yang masuk
 * atau keluar), tapi HPP dan jumlah pesanannya hanya boleh dihitung SEKALI:
 * di periode tempat pesanan itu PERTAMA kali cair. Kalau tidak, barang yang
 * sama terhitung modalnya dua kali.
 */
const PERTAMA = (alias) => `
  (SELECT MIN(y.statement_time) FROM tiktok_statement_tx y
    WHERE y.order_id = ${alias}.order_id) >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')`;

/**
 * Pesanan yang DIREFUND PENUH tidak boleh dibebani HPP.
 *
 * DITEMUKAN 1 Okt 2026 dari berkas income September Humaira: 195 dari 762
 * baris "Pesanan" (25,6%) adalah refund penuh — Jumlah penyelesaian 0
 * (atau sedikit negatif), dibatalkan/dikembalikan setelah dibayar. Barangnya
 * tidak terjual, tapi dulu HPP-nya tetap dihitung: ±Rp 34 jt untuk
 * September, dan uang masuk per unit Easytouch GCU terbaca ±Rp 170 rb
 * padahal pesanan yang benar-benar cair rata-rata ±Rp 232 rb.
 *
 * Patokannya jumlah seluruh baris pesanan itu di semua statement: kalau
 * totalnya tidak lebih dari nol, pesanan itu tidak menghasilkan apa pun dan
 * tidak dihitung — tidak ada qty, tidak ada HPP, tidak ikut jumlah pesanan.
 */
const DIHITUNG = (alias) => `(${PERTAMA(alias)}
  AND (SELECT SUM(z.settlement_amount) FROM tiktok_statement_tx z
        WHERE z.order_id = ${alias}.order_id) > 0)`;

/**
 * HPP per pesanan TikTok, paket diuraikan ke komponen, tarif HPP pada
 * TANGGAL PESANAN — sama persis dengan Shopee. Dipakai sebagai CTE.
 * Parameter: $1 = daftar order_id (text[]).
 */
const HPP_PESANAN = `
  hpp_tt AS (
    SELECT i.order_id,
           SUM(COALESCE(c.qty, 1) * hpp_pada(COALESCE(c.child_id, m.master_sku_id),
                 (o.create_time AT TIME ZONE 'Asia/Jakarta')::date))          AS hpp,
           COUNT(DISTINCT i.line_item_id) FILTER (WHERE m.master_sku_id IS NULL) AS tanpa_hpp
      FROM tiktok_order_items i
      JOIN tiktok_orders o ON o.order_id = i.order_id
      LEFT JOIN tiktok_sku_mapping m ON m.shop_id = i.shop_id AND m.seller_sku = i.seller_sku
      LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
      LEFT JOIN master_sku_component c ON c.parent_id = ms.id AND ms.kind = 'paket'
     WHERE i.order_id IN (SELECT order_id FROM pesanan_cair)
     GROUP BY i.order_id
  )`;

/**
 * Ringkasan keuangan TikTok per toko untuk rentang TANGGAL CAIR [dari, sampai).
 * `dari`/`sampai` berupa tanggal 'YYYY-MM-DD' (sampai eksklusif) atau Date.
 *
 * Bentuk tiap baris sama dengan ringkasPeriode() Shopee di lib/keuangan.js.
 */
/**
 * Potongan iklan TikTok = STATEMENT TANPA TRANSAKSI yang nilainya negatif.
 *
 * Yang TERBUKTI dari data September 2026 (Humaira): 30 statement yang punya
 * transaksi cocok PERSIS sampai rupiah dengan jumlah transaksinya, dan tidak
 * ada satu pun transaksi berjenis iklan. Selisih −Rp 25,8 jt antara uang
 * yang benar-benar dibayar dan jumlah transaksi SELURUHNYA datang dari
 * statement yang transaksinya NOL dengan settlement negatif.
 *
 * Yang masih DUGAAN: bahwa statement-statement itu adalah pembayaran GMV Max
 * yang dipotong dari penghasilan (di berkas income: "Pembayaran GMV untuk
 * Iklan TikTok"). Itu satu-satunya potongan besar tanpa pesanan yang
 * dikenal, tapi belum dicocokkan dengan angka dari Seller Center. Kalau
 * belanja GMV Max di Seller Center lebih besar dari jumlah ini, sisanya
 * kemungkinan dibayar dari saldo iklan dan memang tidak lewat statement.
 * Rinciannya selalu tampil di /api/tiktok/diagnosa-keuangan.
 *
 * Syarat tx_ditarik_at terisi penting: statement yang transaksinya belum
 * ditarik juga punya 0 baris, tapi itu "belum tahu", bukan "iklan".
 */
export async function iklanStatementTiktok(dari, sampai) {
  const rows = await q(`
    SELECT s.shop_id, MAX(t.shop_name) AS shop_name,
           COUNT(*)::int AS statement, SUM(s.settlement_amount) AS jumlah
      FROM tiktok_statements s
      LEFT JOIN tiktok_shops t ON t.shop_id = s.shop_id
     WHERE s.tx_ditarik_at IS NOT NULL AND COALESCE(s.tx_jumlah, 0) = 0
       AND s.settlement_amount < 0
       AND NOT EXISTS (SELECT 1 FROM tiktok_statement_tx x WHERE x.statement_id = s.statement_id)
       AND (s.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
       AND (s.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
     GROUP BY s.shop_id`, [dari, sampai]);
  return new Map(rows.map((r) => [String(r.shop_id),
    { statement: r.statement, nama: r.shop_name, beban: -(Number(r.jumlah) || 0) }]));
}

/**
 * Belanja iklan TikTok yang DIISI MANUAL per hari (halaman TikTok Shop),
 * dari angka GMV Max di Seller Center. Dikonfirmasi Prima 1 Okt 2026:
 * belanja GMV Max LEBIH BESAR dari potongan statement — sebagian dibayar
 * dari saldo iklan dan tidak pernah lewat statement.
 */
async function iklanManualTiktok(dari, sampai) {
  const rows = await q(`
    SELECT a.shop_id, MAX(t.shop_name) AS shop_name, SUM(a.biaya) AS jumlah, COUNT(*)::int AS hari
      FROM tiktok_ad_spend a LEFT JOIN tiktok_shops t ON t.shop_id = a.shop_id
     WHERE a.day >= $1::date AND a.day < $2::date
     GROUP BY a.shop_id`, [dari, sampai]);
  return new Map(rows.map((r) => [String(r.shop_id),
    { nama: r.shop_name, beban: Number(r.jumlah) || 0, hari: r.hari }]));
}

export async function keuanganTiktok(dari, sampai) {
  const iklanSt = await iklanStatementTiktok(dari, sampai).catch(() => new Map());
  const iklanMn = await iklanManualTiktok(dari, sampai).catch(() => new Map());
  const rows = await q(`
    WITH tx AS (
      SELECT x.*, ${JENIS_SQL('x')} AS jenis
        FROM tiktok_statement_tx x
       WHERE (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
         AND (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
    ),
    pesanan_cair AS (
      SELECT DISTINCT t.shop_id, t.order_id FROM tx t
       WHERE t.jenis = 'pesanan' AND ${DIHITUNG('t')}
    ),
    ${HPP_PESANAN}
    SELECT s.shop_id, ts.shop_name,
           (SELECT COUNT(*) FROM pesanan_cair p WHERE p.shop_id = s.shop_id)::int      AS pesanan,
           COALESCE(SUM(t.settlement_amount) FILTER (WHERE t.jenis = 'pesanan'), 0)    AS penjualan,
           COALESCE(SUM(t.settlement_amount) FILTER (WHERE t.jenis = 'iklan'), 0)      AS iklan_mentah,
           COALESCE(SUM(t.settlement_amount) FILTER (WHERE t.jenis = 'lain'), 0)       AS lain,
           (SELECT COALESCE(SUM(h.hpp), 0) FROM hpp_tt h
              JOIN pesanan_cair p ON p.order_id = h.order_id WHERE p.shop_id = s.shop_id) AS hpp,
           (SELECT COALESCE(SUM(h.tanpa_hpp), 0) FROM hpp_tt h
              JOIN pesanan_cair p ON p.order_id = h.order_id WHERE p.shop_id = s.shop_id)::int AS tanpa_hpp,
           -- Pesanan cair yang barisnya belum pernah ditarik: HPP-nya nol
           -- bukan karena murah, tapi karena datanya tidak ada.
           (SELECT COUNT(*) FROM pesanan_cair p
             WHERE p.shop_id = s.shop_id
               AND NOT EXISTS (SELECT 1 FROM tiktok_order_items i WHERE i.order_id = p.order_id))::int
                                                                                        AS tanpa_data
      FROM (SELECT DISTINCT shop_id FROM tx) s
      JOIN tx t ON t.shop_id = s.shop_id
      LEFT JOIN tiktok_shops ts ON ts.shop_id = s.shop_id
     GROUP BY s.shop_id, ts.shop_name`, [dari, sampai]);

  const PPN = Number(process.env.PPN_IKLAN_PCT || 11) / 100;
  const hasil = rows.map((r) => {
    const penjualan = Number(r.penjualan) || 0;
    const hpp = Number(r.hpp) || 0;
    // Dua sumber potongan iklan, keduanya negatif (uang keluar), dibalik
    // jadi beban: statement tanpa transaksi (yang terbukti dipakai), dan
    // transaksi ber-type iklan (berjaga kalau TikTok mengubah bentuknya).
    const st = iklanSt.get(String(r.shop_id));
    iklanSt.delete(String(r.shop_id));
    const mn = iklanMn.get(String(r.shop_id));
    iklanMn.delete(String(r.shop_id));
    /**
     * Potongan statement adalah CARA BAYAR sebagian iklan, bukan biaya
     * tambahan. Kalau belanja manual (angka GMV Max penuh dari Seller Center)
     * sudah diisi, itulah bebannya; potongan statement tidak ditambahkan lagi
     * supaya tidak dobel. Yang diambil yang LEBIH BESAR: belanja manual yang
     * baru terisi sebagian bulan tidak boleh membuat beban lebih kecil dari
     * uang yang terbukti sudah dipotong.
     */
    const bebanStatement = Math.max(-(Number(r.iklan_mentah) || 0), 0) + (st?.beban || 0);
    const bebanManual = mn?.beban || 0;
    const beban = Math.max(bebanStatement, bebanManual);
    const ppn = beban * PPN;
    const iklan = beban + ppn;
    const margin = penjualan - hpp;
    return {
      shopId: `tt-${r.shop_id}`,
      nama: `${r.shop_name || r.shop_id} (TikTok)`,
      platform: 'TikTok Shop',
      manual: false,
      pesanan: Number(r.pesanan) || 0,
      penjualan, hpp, margin,
      bebanIklan: beban, bonus: 0, iklanKotor: beban, ppn, iklan,
      grossProfit: margin - iklan,
      barisTanpaHpp: (Number(r.tanpa_hpp) || 0) + (Number(r.tanpa_data) || 0),
      tanpaData: Number(r.tanpa_data) || 0,
      lain: Number(r.lain) || 0,
      statementIklan: st?.statement || 0,
      iklanStatement: bebanStatement, iklanManual: bebanManual, hariIklanManual: mn?.hari || 0,
      sumberIklan: bebanManual >= bebanStatement && bebanManual > 0 ? 'manual' : 'statement',
    };
  });
  // Toko yang pada periode ini hanya punya potongan iklan (tanpa penjualan
  // cair) tetap harus tampil — kalau tidak, bebannya hilang dari laporan.
  const sisa = new Set([...iklanSt.keys(), ...iklanMn.keys()]);
  for (const shopId of sisa) {
    const st = iklanSt.get(shopId);
    const mn = iklanMn.get(shopId);
    const beban = Math.max(st?.beban || 0, mn?.beban || 0);
    const ppn = beban * PPN;
    hasil.push({
      shopId: `tt-${shopId}`, nama: `${st?.nama || mn?.nama || shopId} (TikTok)`, platform: 'TikTok Shop',
      manual: false, pesanan: 0, penjualan: 0, hpp: 0, margin: 0,
      bebanIklan: beban, bonus: 0, iklanKotor: beban, ppn, iklan: beban + ppn,
      grossProfit: -(beban + ppn), barisTanpaHpp: 0, tanpaData: 0, lain: 0,
      statementIklan: st?.statement || 0,
      iklanStatement: st?.beban || 0, iklanManual: mn?.beban || 0, hariIklanManual: mn?.hari || 0,
      sumberIklan: (mn?.beban || 0) >= (st?.beban || 0) && (mn?.beban || 0) > 0 ? 'manual' : 'statement',
    });
  }
  return hasil;
}

/** Rincian per `type` transaksi — untuk pencocokan dengan berkas income. */
export async function rincianJenisTiktok(dari, sampai) {
  return q(`
    SELECT x.shop_id, ts.shop_name, x.tipe, ${JENIS_SQL('x')} AS jenis,
           COUNT(*)::int AS baris,
           COUNT(DISTINCT x.order_id)::int AS pesanan,
           SUM(x.settlement_amount) AS settlement,
           SUM(x.revenue_amount) AS revenue,
           SUM(x.fee_amount) AS fee
      FROM tiktok_statement_tx x
      LEFT JOIN tiktok_shops ts ON ts.shop_id = x.shop_id
     WHERE (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
       AND (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
     GROUP BY 1,2,3,4 ORDER BY 1, ABS(SUM(x.settlement_amount)) DESC`, [dari, sampai]);
}

/** Apakah transaksi TikTok sudah tersedia untuk rentang ini (untuk menggantikan data manual). */
export async function adaTransaksiTiktok(dari, sampai) {
  const r = await one(`
    SELECT COUNT(*)::int AS n FROM tiktok_statement_tx
     WHERE (statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
       AND (statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date`, [dari, sampai]);
  return (r?.n || 0) > 0;
}

/**
 * Baris per pesanan per SKU TikTok — isi lembar LAPORAN PENGHASILAN.
 * Uang masuk pesanan dibagi PROPORSIONAL ke barisnya menurut harga jual,
 * sama seperti detailPeriode() Shopee.
 */
export async function detailTiktok(dari, sampai) {
  return q(`
    WITH tx AS (
      SELECT x.*, ${JENIS_SQL('x')} AS jenis FROM tiktok_statement_tx x
       WHERE (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
         AND (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
    ),
    cair AS (
      SELECT t.shop_id, t.order_id, SUM(t.settlement_amount) AS uang,
             BOOL_AND(${DIHITUNG('t')}) AS pertama
        FROM tx t WHERE t.jenis = 'pesanan' GROUP BY t.shop_id, t.order_id
    ),
    baris AS (
      SELECT c.shop_id, c.order_id, c.uang, c.pertama, i.seller_sku, i.sale_price,
             o.create_time, m.master_sku_id,
             COUNT(*) OVER (PARTITION BY c.order_id, i.seller_sku, i.sale_price) AS qty_grup,
             ROW_NUMBER() OVER (PARTITION BY c.order_id, i.seller_sku, i.sale_price
                                ORDER BY i.line_item_id) AS ke,
             SUM(i.sale_price) OVER (PARTITION BY c.order_id) AS subtotal_pesanan
        FROM cair c
        LEFT JOIN tiktok_order_items i ON i.order_id = c.order_id
        LEFT JOIN tiktok_orders o ON o.order_id = c.order_id
        LEFT JOIN tiktok_sku_mapping m ON m.shop_id = i.shop_id AND m.seller_sku = i.seller_sku
    )
    SELECT ts.shop_name, b.shop_id, b.order_id AS order_sn,
           COALESCE(ms.code, b.seller_sku, '(data pesanan belum ditarik)') AS sku,
           (b.create_time AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
           -- Pesanan yang sudah cair di periode sebelumnya: uangnya tetap
           -- tampil (misalnya potongan refund), tapi qty & HPP nol.
           CASE WHEN NOT b.pertama OR (b.seller_sku IS NULL AND b.sale_price IS NULL)
                THEN 0 ELSE b.qty_grup END AS qty,
           ROUND(CASE WHEN COALESCE(b.subtotal_pesanan,0) > 0
                      THEN b.uang * (b.sale_price * b.qty_grup) / b.subtotal_pesanan
                      ELSE b.uang END) AS uang_masuk,
           CASE WHEN ms.kind = 'paket' THEN (
                  SELECT SUM(c.qty * hpp_pada(c.child_id, (b.create_time AT TIME ZONE 'Asia/Jakarta')::date))
                    FROM master_sku_component c WHERE c.parent_id = ms.id)
                WHEN ms.id IS NOT NULL
                  THEN hpp_pada(ms.id, (b.create_time AT TIME ZONE 'Asia/Jakarta')::date)
                ELSE 0 END AS hpp_satuan
      FROM baris b
      LEFT JOIN master_sku ms ON ms.id = b.master_sku_id
      LEFT JOIN tiktok_shops ts ON ts.shop_id = b.shop_id
     WHERE b.ke = 1 OR b.ke IS NULL
     ORDER BY ts.shop_name, b.order_id, b.seller_sku`, [dari, sampai]);
}

/**
 * Per Master SKU TikTok untuk rentang tanggal cair — untuk digabung dengan
 * rekap per SKU Shopee. Uang dibagi proporsional seperti detailTiktok.
 */
export async function perSkuTiktok(dari, sampai, { shopId = null } = {}) {
  return q(`
    WITH tx AS (
      SELECT x.*, ${JENIS_SQL('x')} AS jenis FROM tiktok_statement_tx x
       WHERE (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
         AND (x.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
         AND ($3::text IS NULL OR x.shop_id = $3)
    ),
    cair AS (
      SELECT t.order_id, SUM(t.settlement_amount) AS uang,
             BOOL_AND(${DIHITUNG('t')}) AS pertama
        FROM tx t WHERE t.jenis = 'pesanan' GROUP BY t.order_id
    ),
    baris AS (
      SELECT i.*, c.uang, c.pertama, o.create_time,
             SUM(i.sale_price) OVER (PARTITION BY i.order_id) AS subtotal_pesanan
        FROM cair c
        JOIN tiktok_order_items i ON i.order_id = c.order_id
        LEFT JOIN tiktok_orders o ON o.order_id = c.order_id
    )
    SELECT COALESCE(ms.code, NULLIF(TRIM(b.seller_sku),''), '(tanpa SKU)') AS sku,
           MIN(b.product_name)            AS nama,
           BOOL_OR(ms.id IS NOT NULL)     AS tertaut,
           COUNT(*) FILTER (WHERE b.pertama)::int AS qty,
           SUM(b.uang * CASE WHEN b.subtotal_pesanan > 0
                 THEN b.sale_price / b.subtotal_pesanan ELSE 0 END) AS uang_masuk,
           SUM(CASE WHEN NOT b.pertama THEN 0 ELSE COALESCE(CASE WHEN ms.kind = 'paket' THEN (
                 SELECT SUM(c.qty * hpp_pada(c.child_id, (b.create_time AT TIME ZONE 'Asia/Jakarta')::date))
                   FROM master_sku_component c WHERE c.parent_id = ms.id)
               WHEN ms.id IS NOT NULL
                 THEN hpp_pada(ms.id, (b.create_time AT TIME ZONE 'Asia/Jakarta')::date) END, 0) END) AS hpp,
           BOOL_OR(ms.id IS NULL)         AS ada_tanpa_hpp,
           (ARRAY_AGG(b.sku_image) FILTER (WHERE b.sku_image IS NOT NULL))[1] AS gambar
      FROM baris b
      LEFT JOIN tiktok_sku_mapping m ON m.shop_id = b.shop_id AND m.seller_sku = b.seller_sku
      LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
     GROUP BY 1`, [dari, sampai, shopId]);
}

/**
 * Tarif potongan TikTok yang diukur dari pesanan yang SUDAH CAIR:
 *   (omzet − uang cair) / omzet
 * — cara yang sama dengan tarifPlatform() Shopee. Transaksi iklan tidak
 * ikut, jadi potongan iklan GMV Max tidak bisa tercampur ke biaya platform.
 * null kalau belum ada transaksi (pemanggil memakai cara lama).
 */
export async function tarifCairTiktok({ hari = 90 } = {}) {
  const rows = await q(`
    WITH cair AS (
      SELECT x.shop_id, x.order_id, SUM(x.settlement_amount) AS uang
        FROM tiktok_statement_tx x
       WHERE ${JENIS_SQL('x')} = 'pesanan'
         AND x.statement_time >= now() - make_interval(days => $1)
       GROUP BY x.shop_id, x.order_id
    ),
    omzet AS (
      SELECT i.order_id, SUM(i.sale_price) AS omzet
        FROM tiktok_order_items i WHERE i.order_id IN (SELECT order_id FROM cair)
       GROUP BY i.order_id
    )
    SELECT c.shop_id, SUM(o.omzet) AS omzet, SUM(c.uang) AS uang, COUNT(*)::int AS n
      FROM cair c JOIN omzet o ON o.order_id = c.order_id
     GROUP BY c.shop_id`, [hari]);
  const peta = new Map();
  for (const r of rows) {
    const om = Number(r.omzet) || 0;
    if (om > 0 && Number(r.n) >= 5) {
      const t = (om - (Number(r.uang) || 0)) / om;
      if (t > 0 && t < 0.6) peta.set(String(r.shop_id), t);
    }
  }
  return peta;
}

/** Uang cair per pesanan TikTok untuk daftar order_id — dipakai Laporan Toko. */
export async function cairPerPesananTiktok(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await q(`
    SELECT x.order_id, SUM(x.settlement_amount) AS uang
      FROM tiktok_statement_tx x
     WHERE x.order_id = ANY($1::text[]) AND ${JENIS_SQL('x')} = 'pesanan'
     GROUP BY x.order_id`, [orderIds]);
  return new Map(rows.map((r) => [r.order_id, Number(r.uang) || 0]));
}
