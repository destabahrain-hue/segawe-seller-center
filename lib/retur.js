import { q, log } from './db';
import { call, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { tokenHidup, tokoAktif } from './tokens';

/**
 * ── Purna jual: menarik retur dari Shopee ──
 *
 * ── SARINGAN create_time TIDAK BERFUNGSI. JANGAN DIPAKAI LAGI. ──
 *
 * Versi pertama modul ini menyaring lewat create_time_from/to dan memotong
 * riwayat menjadi rentang 15 hari. Mesin itu berjalan mulus, melapor
 * "selesai" untuk kedelapan toko, dan menyimpan NOL baris selama berbulan-
 * bulan. Sebabnya: get_return_list menerima create_time_from/to tanpa
 * protes, bahkan menolak rentang di atas 15 hari dengan error_param yang
 * meyakinkan — tapi tidak pernah memulangkan retur yang jelas ada di dalam
 * jendelanya. Diuji delapan kali di dua toko dengan retur sungguhan yang
 * tanggalnya sudah diketahui lebih dulu; nol dari delapan ketemu, termasuk
 * retur berumur seminggu.
 *
 * Karena itu penarikan sekarang memakai PAGINASI POLOS tanpa saringan
 * waktu sama sekali. Lebih sederhana, dan sekaligus menutup lubang lain:
 * versi lama membatasi sapuan mundur pada pesanan terlama di tabel orders,
 * padahal orders cuma menyimpan beberapa bulan sementara retur ada sejak
 * 2024 — seluruh riwayat sebelum itu tidak akan pernah tersentuh.
 *
 * ── page_size WAJIB 50. JANGAN DINAIKKAN. ──
 *
 * page_size 100 memulangkan NOL baris tanpa galat apa pun: bukan ditolak,
 * bukan error, hanya daftar kosong dengan more:false. Terlihat persis
 * seperti "toko ini memang tidak punya retur". 20 dan 50 bekerja normal.
 *
 * ── Urutan: TERLAMA DULU ──
 *
 * Retur dipulangkan menaik menurut create_time, jadi yang TERBARU ada di
 * halaman TERAKHIR. Setiap sapuan harus menembus sampai halaman terakhir;
 * berhenti di tengah berarti retur terbaru — yang justru punya tenggat —
 * tidak pernah terbaca. Untungnya murah: 50 baris per panggilan.
 */

/** Batas nyata Shopee, terukur dari perilaku: 100 memulangkan nol diam-diam. */
const UKURAN = 50;
/** Pagar pengaman: 60 x 50 = 3.000 retur per toko. */
const MAKS_HALAMAN = 60;

const wkt = (detik) => (Number(detik) > 0 ? new Date(Number(detik) * 1000).toISOString() : null);

/** Simpan satu retur. Kolom mentah disimpan supaya field baru dari Shopee
 *  tidak hilang diam-diam sebelum sempat kita tampilkan. */
async function simpanRetur(shopId, r) {
  await q(`
    INSERT INTO returns (
      return_sn, shop_id, order_sn, status, reason, text_reason, reassessed_reason,
      refund_amount, amount_before_discount, currency,
      create_time, update_time, due_date, ship_due_date, seller_due_date,
      tracking_number, needs_logistics, negotiation_status, proof_status,
      compensation_status, refund_type, solution, request_type, validation_type,
      arrived_at_wh, seller_arrange, proof_mandatory, buyer_username,
      dispute_reason, dispute_text, images, items, follow_up, mentah, fetched_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30::jsonb,$31::jsonb,
            $32::jsonb,$33::jsonb,$34::jsonb, now())
    ON CONFLICT (return_sn) DO UPDATE SET
      status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      text_reason = EXCLUDED.text_reason,
      reassessed_reason = EXCLUDED.reassessed_reason,
      refund_amount = EXCLUDED.refund_amount,
      update_time = EXCLUDED.update_time,
      due_date = EXCLUDED.due_date,
      ship_due_date = EXCLUDED.ship_due_date,
      seller_due_date = EXCLUDED.seller_due_date,
      tracking_number = COALESCE(EXCLUDED.tracking_number, returns.tracking_number),
      negotiation_status = EXCLUDED.negotiation_status,
      proof_status = EXCLUDED.proof_status,
      compensation_status = EXCLUDED.compensation_status,
      arrived_at_wh = EXCLUDED.arrived_at_wh,
      dispute_reason = EXCLUDED.dispute_reason,
      dispute_text = EXCLUDED.dispute_text,
      images = EXCLUDED.images,
      items = EXCLUDED.items,
      follow_up = EXCLUDED.follow_up,
      mentah = EXCLUDED.mentah,
      fetched_at = now()`,
    [
      String(r.return_sn), shopId, r.order_sn || null, r.status || null,
      r.reason || null, r.text_reason || null,
      r.reassessed_request_reason && r.reassessed_request_reason !== 'NONE'
        ? r.reassessed_request_reason : null,
      Number(r.refund_amount) || 0, Number(r.amount_before_discount) || 0,
      r.currency || 'IDR',
      wkt(r.create_time), wkt(r.update_time), wkt(r.due_date),
      wkt(r.return_ship_due_date), wkt(r.return_seller_due_date),
      r.tracking_number || null,
      r.needs_logistics ?? null,
      r.negotiation_status || null, r.seller_proof_status || null,
      r.seller_compensation_status || null, r.return_refund_type || null,
      r.return_solution ?? null, r.return_refund_request_type ?? null,
      r.validation_type || null, r.is_arrived_at_warehouse ?? null,
      r.is_seller_arrange ?? null, r.is_shipping_proof_mandatory ?? null,
      r.user?.username || null,
      JSON.stringify(r.dispute_reason || []),
      JSON.stringify(r.dispute_text_reason || []),
      JSON.stringify(r.image || []),
      JSON.stringify(r.item || []),
      JSON.stringify(r.follow_up_action_list || []),
      JSON.stringify(r),
    ]);
}

/** Satu halaman. page_size dipaku UKURAN — lihat catatan di kepala berkas. */
async function tarikHalaman(shopId, token, halaman) {
  const json = await call(EP.returList, {
    accessToken: token, shopId,
    params: { page_no: halaman, page_size: UKURAN },
  });
  const r = json.response || {};
  return { daftar: Array.isArray(r.return) ? r.return : [], more: !!r.more };
}

/**
 * Sapuan satu toko: seluruh halaman, dari awal sampai habis.
 *
 * Tidak ada lagi posisi yang disimpan dan dilanjutkan. Karena Shopee
 * memulangkan terlama-dulu, retur terbaru selalu di halaman terakhir, jadi
 * berhenti di tengah justru melewatkan yang paling mendesak. Menyapu semua
 * halaman juga membuat perubahan status retur lama ikut tertangkap tanpa
 * mekanisme tambahan.
 *
 * Argumen lama (potongan, majuHari) sengaja masih diterima supaya pemanggil
 * yang ada tidak perlu diubah, tapi diabaikan.
 */
export async function sapuReturToko(shopId, { maksHalaman = MAKS_HALAMAN } = {}) {
  const token = await tokenHidup(shopId);

  await q(`INSERT INTO returns_sapuan (shop_id) VALUES ($1) ON CONFLICT (shop_id) DO NOTHING`,
    [shopId]);

  const terlihat = new Set();
  let halaman = 1, tersimpan = 0, dilihat = 0, gagalSimpan = 0;
  let sampaiUjung = false;
  let terlama = null, terbaru = null;

  while (halaman <= maksHalaman) {
    const { daftar, more } = await tarikHalaman(shopId, token, halaman);
    if (!daftar.length) { sampaiUjung = true; break; }

    let baru = 0;
    for (const x of daftar) {
      if (!x?.return_sn || terlihat.has(x.return_sn)) continue;
      terlihat.add(x.return_sn);
      baru++;
      const t = Number(x.create_time) || 0;
      if (t > 0) {
        if (!terlama || t < terlama) terlama = t;
        if (!terbaru || t > terbaru) terbaru = t;
      }
      try { await simpanRetur(shopId, x); tersimpan++; }
      catch { gagalSimpan++; }   // satu baris gagal tidak menghentikan sisanya
    }
    dilihat += daftar.length;

    // Kalau satu halaman penuh tapi tidak ada return_sn baru, Shopee
    // memutar halaman yang sama — berhenti daripada berputar sampai pagar.
    if (!baru) { sampaiUjung = true; break; }
    if (!more) { sampaiUjung = true; break; }
    halaman++;
    await tidur(JEDA_MS);
  }

  const catatan = `${tersimpan} tersimpan dari ${dilihat} baris, ${halaman} halaman`
    + (sampaiUjung ? '' : ' (BERHENTI DI PAGAR, masih ada halaman)')
    + (gagalSimpan ? `, ${gagalSimpan} baris gagal disimpan` : '');

  await q(`UPDATE returns_sapuan
              SET mundur_sampai = CASE WHEN $2::bigint > 0 THEN to_timestamp($2) ELSE NULL END,
                  selesai = $3, ketemu = $4, hari_potong = 0,
                  last_run = now(), last_note = $5
            WHERE shop_id = $1`,
    [shopId, terlama || 0, sampaiUjung, tersimpan, catatan]);

  return {
    shopId, tersimpan, dilihat, halaman, sampaiUjung, gagalSimpan,
    terlama: terlama ? new Date(terlama * 1000).toISOString() : null,
    terbaru: terbaru ? new Date(terbaru * 1000).toISOString() : null,
  };
}

/** Semua toko. Kegagalan satu toko tidak menjatuhkan yang lain. */
export async function sapuReturSemua(opsi = {}) {
  const hasil = [];
  for (const t of await tokoAktif()) {
    try {
      hasil.push({ ok: true, nama: t.shop_name, ...(await sapuReturToko(t.shop_id, opsi)) });
    } catch (e) {
      hasil.push({ ok: false, nama: t.shop_name, shopId: t.shop_id, error: e.message });
    }
  }
  const n = hasil.reduce((a, x) => a + (x.tersimpan || 0), 0);
  if (n) await log('retur', `${n} retur tersimpan dari ${hasil.filter((x) => x.ok).length} toko`);
  return hasil;
}

/** Ringkasan untuk kartu di atas halaman. */
export async function ringkasRetur() {
  const [r] = await q(`
    SELECT COUNT(*)::int AS semua,
           COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date > now())::int AS perlu_tanggapi,
           COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <= now()
                              AND status NOT IN ('CLOSED','CANCELLED','JUDGING'))::int AS lewat,
           COALESCE(SUM(refund_amount) FILTER (
             WHERE status NOT IN ('CANCELLED')), 0) AS nilai_refund,
           COUNT(*) FILTER (WHERE create_time > now() - interval '7 days')::int AS baru_7hari
      FROM returns`);
  return r || {};
}
