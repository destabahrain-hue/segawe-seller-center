import { q, one } from './db';
import { panggil, tokenHidupTiktok, tokoTiktok } from './tiktok';
import { sidikPembeli } from './pembeli';

/**
 * ── Penarikan data TikTok Shop ──
 *
 * Bentuk balasan TikTok sudah dibuktikan lewat /api/tiktok/uji-endpoint,
 * bukan dari dokumentasi saja. Yang penting diingat:
 *
 *  • Semua nilai uang datang sebagai STRING ("123456.78"), bukan angka.
 *  • Semua waktu datang sebagai detik Unix.
 *  • Paginasi memakai next_page_token, BUKAN nomor halaman. Token kosong
 *    berarti habis — jangan berhenti hanya karena satu halaman kurang dari
 *    page_size, karena TikTok kadang memulangkan halaman pendek di tengah.
 *  • BATAS HALAMAN ADALAH JEBAKAN. Versi pertama berhenti di 40 halaman dan
 *    hasilnya persis 2.000 pesanan — terlihat seperti angka sungguhan,
 *    padahal penarikan terpotong di tengah jalan tanpa memberi tahu siapa
 *    pun. Sekarang penarikan dipecah per jendela waktu, berhenti karena
 *    ANGGARAN WAKTU (bukan jumlah halaman), dan selalu melaporkan apakah
 *    hasilnya terpotong beserta sampai tanggal berapa.
 *  • line_items sudah ikut di hasil pencarian pesanan, jadi TIDAK perlu
 *    panggilan detail per pesanan seperti di Shopee. Jauh lebih hemat.
 */

const uang = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const waktu = (d) => (d ? new Date(Number(d) * 1000) : null);

/** Kota & provinsi dari district_info; sisanya (nama, telepon, alamat) dibuang. */
function wilayah(alamat) {
  const d = Array.isArray(alamat?.district_info) ? alamat.district_info : [];
  const ambil = (tingkat) => d.find((x) => x.address_level_name === tingkat)?.address_name || null;
  return {
    provinsi: ambil('Province') || ambil('State') || d[0]?.address_name || null,
    kota: ambil('City') || ambil('Regency') || d[1]?.address_name || null,
  };
}

/**
 * Ambil semua halaman satu endpoint. Batas halaman dipasang supaya satu
 * tugas antrean tidak berjalan tanpa akhir kalau TikTok memulangkan token
 * yang berputar.
 */
async function semuaHalaman(path, {
  token, cipher, body = {}, params = {}, kunci, method = 'POST',
  maks = 500, sampaiMs = null,
}) {
  const keluar = [];
  let pageToken = null;
  let terpotong = false;
  for (let i = 0; i < maks; i++) {
    const json = await panggil(path, {
      method, token, shopCipher: cipher,
      params: { page_size: 50, ...params, ...(pageToken ? { page_token: pageToken } : {}) },
      body,
    });
    keluar.push(...(json.data?.[kunci] || []));
    pageToken = json.data?.next_page_token || null;
    if (!pageToken) break;
    if (sampaiMs && Date.now() > sampaiMs) { terpotong = true; break; }
    if (i === maks - 1) terpotong = true;
  }
  return { baris: keluar, terpotong };
}

/** Pesanan + barisnya, untuk rentang waktu tertentu. */
export async function tarikPesananTiktok(shopId, { dari, sampai, detik = 45 } = {}) {
  const t = await tokenHidupTiktok(shopId);
  const kini = Math.floor(Date.now() / 1000);
  const ge = dari ? Math.floor(new Date(dari).getTime() / 1000) : kini - 7 * 86400;
  const lt = sampai ? Math.floor(new Date(sampai).getTime() / 1000) : kini;
  const batasWaktu = Date.now() + detik * 1000;

  /**
   * Dipecah per 7 hari dan dikerjakan dari yang TERLAMA. Kalau anggaran
   * waktu habis di tengah, yang sudah masuk adalah bagian terlama secara
   * utuh, dan penanda `pesanan_sampai` menunjuk batas jendela terakhir yang
   * benar-benar selesai — jadi penarikan berikutnya melanjutkan, bukan
   * mengulang dari nol.
   */
  const JENDELA = 7 * 86400;
  let pesanan = 0, baris = 0, selesaiSampai = ge, terpotong = false;

  for (let a = ge; a < lt; a += JENDELA) {
    if (Date.now() > batasWaktu) { terpotong = true; break; }
    const b = Math.min(a + JENDELA, lt);
    const hasil = await semuaHalaman('/order/202309/orders/search', {
      token: t.access_token, cipher: t.shop_cipher, kunci: 'orders',
      params: { sort_field: 'create_time', sort_order: 'ASC' },
      body: { create_time_ge: a, create_time_lt: b },
      sampaiMs: batasWaktu,
    });

    for (const o of hasil.baris) {
      const p = o.payment || {};
      const w = wilayah(o.recipient_address);
      await q(`
        INSERT INTO tiktok_orders (order_id, shop_id, status, order_type, create_time, update_time,
          rts_time, collection_time, delivery_type, shipping_provider, tracking_number, is_cod,
          currency, total_amount, sub_total, shipping_fee, original_shipping_fee, platform_discount,
          seller_discount, buyer_service_fee, tax, kota, provinsi, pembeli_id,
          batas_kirim, bayar_time, paket_id, fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
                $25,$26,$27, now())
        ON CONFLICT (order_id) DO UPDATE SET
          status = EXCLUDED.status, update_time = EXCLUDED.update_time,
          rts_time = COALESCE(EXCLUDED.rts_time, tiktok_orders.rts_time),
          collection_time = COALESCE(EXCLUDED.collection_time, tiktok_orders.collection_time),
          tracking_number = COALESCE(EXCLUDED.tracking_number, tiktok_orders.tracking_number),
          shipping_provider = COALESCE(EXCLUDED.shipping_provider, tiktok_orders.shipping_provider),
          total_amount = EXCLUDED.total_amount, sub_total = EXCLUDED.sub_total,
          shipping_fee = EXCLUDED.shipping_fee, platform_discount = EXCLUDED.platform_discount,
          seller_discount = EXCLUDED.seller_discount, tax = EXCLUDED.tax,
          kota = COALESCE(EXCLUDED.kota, tiktok_orders.kota),
          provinsi = COALESCE(EXCLUDED.provinsi, tiktok_orders.provinsi),
          pembeli_id = COALESCE(tiktok_orders.pembeli_id, EXCLUDED.pembeli_id),
          batas_kirim = COALESCE(EXCLUDED.batas_kirim, tiktok_orders.batas_kirim),
          bayar_time = COALESCE(tiktok_orders.bayar_time, EXCLUDED.bayar_time),
          paket_id = COALESCE(EXCLUDED.paket_id, tiktok_orders.paket_id),
          fetched_at = now()`,
        [o.id, String(shopId), o.status || null, o.order_type || null,
         waktu(o.create_time), waktu(o.update_time), waktu(o.rts_time), waktu(o.collection_time),
         o.delivery_type || null, o.shipping_provider || null, o.tracking_number || null,
         o.is_cod ?? null, p.currency || null,
         uang(p.total_amount), uang(p.sub_total), uang(p.shipping_fee),
         uang(p.original_shipping_fee), uang(p.platform_discount), uang(p.seller_discount),
         uang(p.buyer_service_fee), uang(p.tax), w.kota, w.provinsi,
         sidikPembeli(shopId, o.user_id),
         /**
          * Tiga field di bawah BELUM dibuktikan lewat /api/tiktok/uji-endpoint
          * — namanya dari dokumentasi TikTok 202309. Dibaca bertahan: kalau
          * field-nya tidak ada, kolomnya NULL dan tidak ada yang rusak
          * (Batas kirim cuma tidak tampil). Pastikan dengan
          * /api/tiktok/uji-endpoint?path=/order/202309/orders/search&dalam=3
          */
         waktu(o.rts_sla_time || o.shipping_due_time || null),
         waktu(o.paid_time || null),
         (Array.isArray(o.packages) && o.packages[0]?.id)
           || (o.line_items || []).find((x) => x.package_id)?.package_id || null]);

      for (const li of o.line_items || []) {
        await q(`
          INSERT INTO tiktok_order_items (line_item_id, order_id, shop_id, product_id, product_name,
            sku_id, seller_sku, sku_name, sku_image, display_status, sale_price, original_price,
            platform_discount, seller_discount, currency)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (line_item_id) DO UPDATE SET
            display_status = EXCLUDED.display_status, sale_price = EXCLUDED.sale_price,
            platform_discount = EXCLUDED.platform_discount,
            seller_discount = EXCLUDED.seller_discount`,
          [li.id, o.id, String(shopId), li.product_id || null, li.product_name || null,
           li.sku_id || null, li.seller_sku || null, li.sku_name || null, li.sku_image || null,
           li.display_status || null, uang(li.sale_price), uang(li.original_price),
           uang(li.platform_discount), uang(li.seller_discount), li.currency || null]);
        baris++;
      }
      pesanan++;
    }

    if (hasil.terpotong) { terpotong = true; break; }   // jendela ini belum tuntas
    selesaiSampai = b;
  }

  await q(`UPDATE tiktok_shops SET pesanan_sampai = GREATEST(COALESCE(pesanan_sampai, to_timestamp(0)), $2),
             last_sync_at = now(), last_error = NULL WHERE shop_id = $1`,
    [String(shopId), new Date(selesaiSampai * 1000)]);

  return { pesanan, baris, terpotong,
           sampai: new Date(selesaiSampai * 1000).toISOString().slice(0, 10) };
}

/** Statement = uang yang benar-benar dibayarkan TikTok ke penjual. */
export async function tarikStatementTiktok(shopId, { halaman = 400, detik = 40 } = {}) {
  const t = await tokenHidupTiktok(shopId);
  const batasWaktu = Date.now() + detik * 1000;
  let pageToken = null;
  let n = 0;
  let terpotong = false;
  for (let i = 0; i < halaman; i++) {
    const json = await panggil('/finance/202309/statements', {
      method: 'GET', token: t.access_token, shopCipher: t.shop_cipher,
      params: { page_size: 50, sort_field: 'statement_time', sort_order: 'DESC',
                ...(pageToken ? { page_token: pageToken } : {}) },
    });
    for (const s of json.data?.statements || []) {
      await q(`
        INSERT INTO tiktok_statements (statement_id, shop_id, statement_time, payment_id,
          payment_status, payment_time, currency, settlement_amount, revenue_amount, fee_amount,
          adjustment_amount, shipping_cost_amount, net_sales_amount, fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
        ON CONFLICT (statement_id) DO UPDATE SET
          payment_status = EXCLUDED.payment_status, payment_time = EXCLUDED.payment_time,
          settlement_amount = EXCLUDED.settlement_amount, revenue_amount = EXCLUDED.revenue_amount,
          fee_amount = EXCLUDED.fee_amount, adjustment_amount = EXCLUDED.adjustment_amount,
          net_sales_amount = EXCLUDED.net_sales_amount, fetched_at = now()`,
        [s.id, String(shopId), waktu(s.statement_time), s.payment_id || null,
         s.payment_status || null, waktu(s.payment_time), s.currency || null,
         uang(s.settlement_amount), uang(s.revenue_amount), uang(s.fee_amount),
         uang(s.adjustment_amount), uang(s.shipping_cost_amount), uang(s.net_sales_amount)]);
      n++;
    }
    pageToken = json.data?.next_page_token || null;
    if (!pageToken) break;
    if (Date.now() > batasWaktu || i === halaman - 1) { terpotong = true; break; }
  }
  await q(`UPDATE tiktok_shops SET statement_sampai = now() WHERE shop_id = $1`, [String(shopId)]);
  return { statement: n, terpotong };
}

export async function tarikReturTiktok(shopId) {
  const t = await tokenHidupTiktok(shopId);
  const hasil = await semuaHalaman('/return_refund/202309/returns/search', {
    token: t.access_token, cipher: t.shop_cipher, kunci: 'return_orders', body: {},
    maks: 200, sampaiMs: Date.now() + 30000,
  });
  for (const r of hasil.baris) {
    await q(`
      INSERT INTO tiktok_returns (return_id, shop_id, order_id, return_status, return_type,
        return_reason, return_reason_text, refund_amount, shipping_fee_amount, discount_amount,
        create_time, update_time, items, fetched_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
      ON CONFLICT (return_id) DO UPDATE SET
        return_status = EXCLUDED.return_status, update_time = EXCLUDED.update_time,
        refund_amount = EXCLUDED.refund_amount, items = EXCLUDED.items, fetched_at = now()`,
      [r.return_id, String(shopId), r.order_id || null, r.return_status || null,
       r.return_type || null, r.return_reason || null, r.return_reason_text || null,
       uang(r.refund_amount), uang(r.shipping_fee_amount), uang(r.discount_amount),
       waktu(r.create_time), waktu(r.update_time),
       JSON.stringify(r.return_line_items || [])]);
  }
  return { retur: hasil.baris.length, terpotong: hasil.terpotong };
}

/** Ringkasan untuk halaman /tiktok. */
export async function ringkasTiktok() {
  return one(`
    SELECT (SELECT COUNT(*) FROM tiktok_orders)::int                      AS pesanan,
           (SELECT COUNT(*) FROM tiktok_order_items)::int                 AS baris,
           (SELECT MIN(create_time) FROM tiktok_orders)                   AS terawal,
           (SELECT MAX(create_time) FROM tiktok_orders)                   AS terakhir,
           (SELECT COUNT(*) FROM tiktok_returns)::int                     AS retur,
           (SELECT COUNT(*) FROM tiktok_statements)::int                  AS statement,
           (SELECT COALESCE(SUM(settlement_amount), 0) FROM tiktok_statements
             WHERE statement_time >= date_trunc('month', now()))          AS cair_bulan_ini,
           (SELECT COALESCE(SUM(total_amount), 0) FROM tiktok_orders
             WHERE create_time >= date_trunc('month', now())
               AND status NOT IN ('CANCELLED','UNPAID'))                  AS omzet_bulan_ini`);
}

/**
 * Menyegarkan STATUS pesanan TikTok yang lebih tua dari jendela rutin.
 *
 * Penarikan rutin hanya menyapu pesanan yang DIBUAT 3 hari terakhir. Pesanan
 * yang dibuat seminggu lalu lalu berubah jadi Dikirim/Selesai tidak pernah
 * ditarik ulang, jadi statusnya membeku — pelajaran yang sama persis dengan
 * Shopee (sinkron harus memperhatikan perubahan, bukan cuma pesanan baru).
 * Sekarang halaman Pesanan menggabungkan TikTok ke tab kerja, jadi status
 * yang membeku langsung terlihat sebagai pesanan "baru" yang tidak pernah
 * pergi.
 *
 * Cara yang TIDAK butuh parameter baru: tiap putaran menyapu ulang SATU
 * potongan 2 hari dengan create_time (parameter yang sudah terbukti),
 * bergeser maju dari 21 hari lalu sampai 3 hari lalu, lalu mulai lagi.
 * 9 potongan × 5 menit ≈ seluruh pesanan 3 minggu terakhir tersegarkan
 * tiap ~45 menit. Pesanan yang masih terbuka lewat 21 hari jarang sekali.
 */
async function segarkanLama(t) {
  const HARI = 86400000;
  const awal = Date.now() - 21 * HARI;
  const akhir = Date.now() - 3 * HARI;
  let mulai = t.segar_kursor ? new Date(t.segar_kursor).getTime() : awal;
  if (!(mulai >= awal && mulai < akhir)) mulai = awal;
  const sampai = Math.min(mulai + 2 * HARI, akhir);
  const p = await tarikPesananTiktok(t.shop_id,
    { dari: new Date(mulai), sampai: new Date(sampai), detik: 25 });
  // Kursor hanya maju kalau potongannya tuntas; kalau terpotong, putaran
  // berikutnya mengulang potongan yang sama.
  const lanjut = p.terpotong ? mulai : (sampai >= akhir ? awal : sampai);
  await q(`UPDATE tiktok_shops SET segar_kursor = $2 WHERE shop_id = $1`,
    [t.shop_id, new Date(lanjut)]);
  return p;
}

/** Dipakai penjadwal: tarik pesanan terbaru semua toko TikTok aktif. */
export async function putarTiktok({ hari = 3 } = {}) {
  const toko = await tokoTiktok();
  const ringkas = [];
  for (const t of toko.filter((x) => x.status === 'active')) {
    try {
      const p = await tarikPesananTiktok(t.shop_id,
        { dari: new Date(Date.now() - hari * 86400000) });
      let lama = null;
      try { lama = await segarkanLama(t); } catch (e) { lama = { galat: e.message }; }
      ringkas.push(`${t.shop_name || t.shop_id}: ${p.pesanan} pesanan`
        + (lama?.galat ? ` (segar lama gagal: ${lama.galat})`
           : lama ? `, ${lama.pesanan} lama disegarkan` : ''));
    } catch (e) {
      await q(`UPDATE tiktok_shops SET last_error = $2 WHERE shop_id = $1`,
        [t.shop_id, e.message.slice(0, 300)]);
      ringkas.push(`${t.shop_name || t.shop_id}: gagal — ${e.message}`);
    }
  }
  // Potong stok gudang untuk pesanan TikTok yang sudah dijemput kurir —
  // setelah status disegarkan di atas, supaya yang baru terkirim ikut.
  try {
    const { potongStokTiktok } = await import('./tiktok-stok');
    const st = await potongStokTiktok();
    if (st.dipotong || st.tanpaTaut) {
      ringkas.push(`stok TikTok ${st.dipotong} pesanan`
        + (st.tanpaTaut ? `, ${st.tanpaTaut} baris belum tertaut` : ''));
    }
  } catch (e) { ringkas.push(`stok TikTok gagal: ${e.message}`); }
  return ringkas;
}

/**
 * ── Penarikan lengkap lewat antrean ──
 *
 * Satu tekan "Tarik semua" harus menghasilkan data lengkap tanpa ditunggui.
 * Caranya: rentangnya dipecah jadi tugas-tugas jendela 7 hari yang masuk
 * antrean, lalu penjadwal mengerjakannya satu per satu di latar belakang —
 * sama seperti penarikan riwayat Shopee.
 *
 * Kenapa tidak dikerjakan langsung di dalam permintaan HTTP: 90 hari bisa
 * ratusan panggilan, dan gateway memutus permintaan jauh sebelum selesai.
 */
export async function antrikanTarikTiktok(shopId, { hari = 90, bagian = 'semua' } = {}) {
  const { antrikan } = await import('./queue');
  const kini = Math.floor(Date.now() / 1000);
  const mulai = kini - Math.min(Math.max(Number(hari) || 90, 1), 730) * 86400;
  const JENDELA = 7 * 86400;
  let tugas = 0;

  if (bagian === 'semua' || bagian === 'pesanan') {
    for (let a = mulai; a < kini; a += JENDELA) {
      await antrikan('tiktok_pesanan', {
        payload: { shop_id: String(shopId), dari: a, sampai: Math.min(a + JENDELA, kini) },
      });
      tugas++;
    }
  }
  if (bagian === 'semua' || bagian === 'statement') {
    await antrikan('tiktok_statement', { payload: { shop_id: String(shopId) } }); tugas++;
    // Transaksi per statement (Laporan Keuangan) diantrikan SETELAH
    // statement-nya, karena daftar statement itulah yang ia telusuri.
    await antrikan('tiktok_transaksi', { payload: { shop_id: String(shopId) } }); tugas++;
  }
  if (bagian === 'semua' || bagian === 'retur') {
    await antrikan('tiktok_retur', { payload: { shop_id: String(shopId) } }); tugas++;
  }
  return { tugas };
}

/** Kemajuan penarikan TikTok — untuk bilah di halaman /tiktok. */
export async function statusTarikTiktok(shopId) {
  const r = await one(`
    SELECT COUNT(*) FILTER (WHERE status IN ('pending','running'))::int AS sisa,
           COUNT(*) FILTER (WHERE status = 'done'
                              AND created_at > now() - interval '2 days')::int AS selesai,
           COUNT(*) FILTER (WHERE status = 'error'
                              AND created_at > now() - interval '2 days')::int AS gagal
      FROM jobs
     WHERE kind IN ('tiktok_pesanan','tiktok_statement','tiktok_transaksi','tiktok_retur')
       AND payload->>'shop_id' = $1`, [String(shopId)]);
  const sisa = r?.sisa || 0, selesai = r?.selesai || 0;
  const total = sisa + selesai;
  return { sisa, selesai, gagal: r?.gagal || 0, total,
           persen: total ? Math.round((selesai / total) * 100) : 100, berjalan: sisa > 0 };
}
