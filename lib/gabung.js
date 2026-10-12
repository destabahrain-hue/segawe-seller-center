import { q } from './db';
import { ringkasan, deret, PPN_IKLAN } from './report';
import { ringkasanTiktok, biayaTiktok } from './tiktok-laporan';
import { tarifCairTiktok, JENIS_SQL } from './tiktok-keuangan';

/**
 * ── Angka gabungan Shopee + TikTok ──
 *
 * Satu pintu untuk Dashboard, Laporan Toko, dan Realtime. Sebelumnya kartu
 * di atas Laporan Toko memakai ringkasan() yang HANYA Shopee, sementara
 * tabel di bawahnya sudah menyertakan TikTok — jadi Omzet bersih di kartu
 * selalu kurang persis sebesar baris TikTok (30 Sep: Rp 84.765.318 vs
 * Rp 93.631.785, selisih Rp 8.866.467 = omzet HUMAIRA INDOSHOP TikTok).
 * Dashboard bahkan tidak menyertakan TikTok sama sekali.
 *
 * Sekarang kartu, tabel, grafik, dan dashboard membaca SATU total yang sama.
 */

const FEE_CADANGAN = () => Number(process.env.EST_PLATFORM_FEE_PCT || 14) / 100;

/**
 * Tarif potongan TikTok yang DIUKUR dari statement 90 hari terakhir.
 *
 * Dulu biaya platform TikTok diambil dari statement yang BERTANGGAL CAIR
 * di dalam rentang. Untuk rentang sebulan itu mendekati, tapi untuk "Hari
 * ini" artinya omzet pesanan hari ini dipotong biaya pesanan yang cair hari
 * ini — dua kelompok pesanan yang sama sekali berbeda.
 *
 * TikTok tidak memberi potongan per pesanan, jadi yang paling jujur adalah
 * cara yang sama dengan pesanan Shopee yang belum cair: ukur tarifnya dari
 * uang yang sudah cair, lalu kenakan ke omzet rentang ini. Tarifnya
 * ditampilkan di layar supaya bisa diperiksa.
 */
export async function tarifTiktok({ hari = 90 } = {}) {
  const rows = await q(`
    SELECT shop_id,
           ABS(COALESCE(SUM(fee_amount), 0))   AS biaya,
           COALESCE(SUM(revenue_amount), 0)    AS pendapatan,
           COUNT(*)::int                        AS statement
      FROM tiktok_statements
     WHERE statement_time >= now() - make_interval(days => $1)
     GROUP BY shop_id`, [hari]);

  const perToko = new Map();
  let biayaAll = 0, pendapatanAll = 0;
  for (const r of rows) {
    const biaya = Number(r.biaya) || 0;
    const pend = Number(r.pendapatan) || 0;
    // Tarif di luar 0–60% hampir pasti berarti statement belum lengkap
    // atau bentuk angkanya berbeda — lebih aman tidak dipakai.
    if (pend > 0 && Number(r.statement) >= 5) {
      const t = biaya / pend;
      if (t > 0 && t < 0.6) {
        perToko.set(String(r.shop_id), t);
        biayaAll += biaya; pendapatanAll += pend;
      }
    }
  }
  const global = pendapatanAll > 0 ? biayaAll / pendapatanAll : null;
  return {
    tarif: (shopId) => perToko.get(String(shopId)) ?? global ?? FEE_CADANGAN(),
    asal: (shopId) => (perToko.has(String(shopId)) ? 'diukur'
      : global !== null ? 'gabungan' : 'cadangan'),
  };
}

/**
 * Uang cair per toko untuk pesanan TikTok yang DIBUAT di rentang ini —
 * dari transaksi statement. Bentuknya sama dengan Shopee: pesanan yang
 * sudah cair biayanya NYATA (omzet − uang cair), sisanya baru ditaksir.
 */
async function cairTiktokRentang(r) {
  const rows = await q(`
    WITH o AS (
      SELECT o.shop_id, o.order_id, SUM(i.sale_price) AS omzet
        FROM tiktok_orders o JOIN tiktok_order_items i ON i.order_id = o.order_id
       WHERE o.status NOT IN ('CANCELLED','UNPAID')
         AND o.create_time >= $1 AND o.create_time < $2
       GROUP BY o.shop_id, o.order_id
    ),
    c AS (
      SELECT x.order_id, SUM(x.settlement_amount) AS uang
        FROM tiktok_statement_tx x
       WHERE x.order_id IN (SELECT order_id FROM o) AND ${JENIS_SQL('x')} = 'pesanan'
       GROUP BY x.order_id
    )
    SELECT o.shop_id,
           COALESCE(SUM(o.omzet) FILTER (WHERE c.order_id IS NOT NULL), 0) AS omzet_cair,
           COALESCE(SUM(c.uang), 0)                                          AS cair,
           COUNT(*) FILTER (WHERE c.order_id IS NULL)::int                   AS belum
      FROM o LEFT JOIN c ON c.order_id = o.order_id
     GROUP BY o.shop_id`, [r.dari, r.sampai]);
  return Object.fromEntries(rows.map((x) => [x.shop_id, x]));
}

/** Baris TikTok, sebentuk dengan baris toko di ringkasan() Shopee. */
async function barisTiktok(r) {
  const [rows, biaya, tarif, tarifCair, cair] = await Promise.all([
    ringkasanTiktok({ dari: r.dari, sampai: r.sampai }).catch(() => []),
    biayaTiktok({ dari: r.dari, sampai: r.sampai }).catch(() => ({})),
    tarifTiktok().catch(() => null),
    tarifCairTiktok().catch(() => new Map()),
    cairTiktokRentang(r).catch(() => ({})),
  ]);
  return (rows || []).map((x) => {
    const b = biaya?.[x.shop_id] || {};
    const c = cair?.[x.shop_id] || {};
    const omzet = Number(x.omzet) || 0;
    const hpp = Number(x.hpp) || 0;
    // Tarif dari pesanan yang sudah cair (tanpa transaksi iklan) lebih
    // dipercaya daripada tarif statement, yang bisa ikut memuat iklan.
    const t = tarifCair.get(String(x.shop_id))
      ?? (tarif ? tarif.tarif(x.shop_id) : FEE_CADANGAN());
    const omzetCair = Number(c.omzet_cair) || 0;
    const uangCair = Number(c.cair) || 0;
    const biayaPlatform = Math.max(omzetCair - uangCair, 0) + Math.max(omzet - omzetCair, 0) * t;
    // Belanja GMV Max diisi manual TANPA PPN (angka Seller Center); PPN 11%
    // ditambahkan di sini supaya sejajar dengan iklan Shopee dan Laporan
    // Keuangan, yang sama-sama sudah termasuk PPN.
    const iklan = (Number(b.iklan) || 0) * (1 + PPN_IKLAN());
    const laba = omzet - hpp - biayaPlatform - iklan;
    return {
      shopId: `tt-${x.shop_id}`, nama: x.shop_name || x.shop_id, platform: 'TikTok Shop',
      pesanan: Number(x.pesanan) || 0, unit: Number(x.unit) || 0,
      omzet, hpp, biaya: biayaPlatform, iklan, laba,
      margin: omzet ? (laba / omzet) * 100 : 0,
      tarif: t, tarifAsal: tarifCair.has(String(x.shop_id)) ? 'cair'
        : tarif ? tarif.asal(x.shop_id) : 'cadangan',
      diterima: uangCair, belumCair: Number(c.belum) || 0,
      tanpaTaut: Number(x.baris_tanpa_taut) || 0,
      tanpaIklan: !Number(b.hari_iklan_terisi),
    };
  });
}

/**
 * Ringkasan gabungan. Bentuk `total` sama dengan ringkasan() lama supaya
 * halaman yang memakainya tidak perlu tahu bedanya; angka yang memang
 * hanya ada di Shopee (dana diterima per pesanan, pesanan belum cair,
 * PPN iklan) tetap Shopee saja dan dinamai begitu di layar.
 */
export async function ringkasanGabung(r) {
  const [sp, tt] = await Promise.all([ringkasan(r), barisTiktok(r)]);

  const toko = [
    ...sp.toko.map((x) => ({ ...x, platform: 'Shopee' })),
    ...tt,
  ].sort((a, b) => b.omzet - a.omzet);

  const jumlahTt = tt.reduce((a, x) => ({
    pesanan: a.pesanan + x.pesanan, unit: a.unit + x.unit, omzet: a.omzet + x.omzet,
    hpp: a.hpp + x.hpp, biaya: a.biaya + x.biaya, iklan: a.iklan + x.iklan, laba: a.laba + x.laba,
    tanpaTaut: a.tanpaTaut + x.tanpaTaut, diterima: a.diterima + x.diterima,
    belumCair: a.belumCair + x.belumCair,
  }), { pesanan: 0, unit: 0, omzet: 0, hpp: 0, biaya: 0, iklan: 0, laba: 0, tanpaTaut: 0,
        diterima: 0, belumCair: 0 });

  const s = sp.total;
  const total = {
    ...s,
    pesanan: s.pesanan + jumlahTt.pesanan,
    unit: s.unit + jumlahTt.unit,
    omzet: s.omzet + jumlahTt.omzet,
    hpp: s.hpp + jumlahTt.hpp,
    biaya: s.biaya + jumlahTt.biaya,
    iklan: s.iklan + jumlahTt.iklan,
    laba: s.laba + jumlahTt.laba,
    // Dana diterima kini sebanding di dua marketplace: uang cair dari
    // pesanan yang DIBUAT di rentang ini.
    diterima: s.diterima + jumlahTt.diterima,
    perkiraan: s.perkiraan + jumlahTt.belumCair,
  };
  total.margin = total.omzet ? (total.laba / total.omzet) * 100 : 0;
  total.shopee = { omzet: s.omzet, pesanan: s.pesanan, laba: s.laba };
  total.tiktok = {
    ...jumlahTt,
    toko: tt.length,
    tanpaIklan: tt.some((x) => x.tanpaIklan),
    tarif: jumlahTt.omzet ? jumlahTt.biaya / jumlahTt.omzet : null,
    cair: jumlahTt.diterima,
  };
  return { toko, total };
}

/**
 * Deret omzet per jam/hari, Shopee + TikTok dijumlah per titik.
 *
 * Bentuk `titik` disamakan dengan deret() Shopee: jam dinding WIB tanpa
 * zona waktu (dibaca pg sebagai UTC), supaya grafik yang sudah ada tidak
 * bergeser.
 */
export async function deretGabung(r) {
  const satuan = r.satuan || 'hour';
  const [sp, tt] = await Promise.all([
    deret({ ...r, satuan }),
    q(`SELECT date_trunc($3, o.create_time AT TIME ZONE 'Asia/Jakarta') AS titik,
              SUM(i.sale_price) AS omzet
         FROM tiktok_orders o
         JOIN tiktok_order_items i ON i.order_id = o.order_id
        WHERE o.status NOT IN ('CANCELLED','UNPAID')
          AND o.create_time >= $1 AND o.create_time < $2
        GROUP BY 1`, [r.dari, r.sampai, satuan]).catch(() => []),
  ]);
  const peta = new Map();
  for (const d of sp) peta.set(new Date(d.titik).getTime(), { titik: d.titik, omzet: d.omzet });
  for (const d of tt) {
    const k = new Date(d.titik).getTime();
    const ada = peta.get(k);
    const n = Number(d.omzet) || 0;
    if (ada) ada.omzet += n; else peta.set(k, { titik: d.titik, omzet: n });
  }
  return [...peta.values()].sort((a, b) => new Date(a.titik) - new Date(b.titik));
}
