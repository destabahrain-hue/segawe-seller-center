import { q, log } from './db';
import { call, tidur } from './shopee';
import { EP } from './endpoints';
import { tokenHidup, tokoAktif } from './tokens';

/**
 * ── Penarik biaya iklan PER PRODUK ──
 *
 * Melengkapi lib/iklan.js, tidak menggantikannya. ad_spend (per toko per
 * hari) tetap jadi angka resmi; tabel ad_spend_item yang diisi di sini
 * adalah rinciannya, dan selalu lebih kecil karena ada iklan yang memang
 * tidak melekat ke produk mana pun.
 *
 * ── DUA JENIS IKLAN, DAN JEBAKAN PENAMAANNYA ──
 *
 * Shopee menyebut jenis pertama "manual" di API. Itu MENYESATKAN: isinya
 * bukan bidding kata kunci, melainkan "Iklan Individual & Grup Iklan" di
 * Seller Centre, yang sekarang berjalan sebagai GMV Max ROAS per produk.
 * Karena itu di seluruh kode dan tampilan dipakai istilah Seller Centre:
 *
 *   individu   Iklan Individual & Grup Iklan. Satu campaign = SATU produk
 *              (terbukti: 405 campaign diperiksa di dua toko, semuanya
 *              item_id_list berisi tepat satu item). Alurnya tiga langkah:
 *              daftar campaign → setting_info (untuk dapat item_id) →
 *              daily_performance (untuk dapat biaya per tanggal).
 *
 *   otomatis   Iklan Produk Otomatis. SATU campaign berisi puluhan produk,
 *              dibaca dari get_gms_item_performance.
 *
 * Beberapa hal yang mahal ditemukan dan mudah terlupa:
 *
 *   - ad_type=auto pada get_product_level_campaign_id_list SELALU nol dan
 *     BUKAN iklan otomatis. Iklan otomatis tidak pernah muncul di daftar itu.
 *   - get_gms_item_performance tidak punya kolom tanggal. Angkanya total
 *     sepanjang rentang, jadi untuk data harian WAJIB dipanggil sehari
 *     sekali. Sudah diuji: jumlah tujuh panggilan harian sama persis dengan
 *     satu panggilan rentang tujuh hari, jadi memecahnya aman.
 *   - Toko yang tidak memakai iklan otomatis membalas
 *     ads_error_product_gms_campaign_not_found. Itu BUKAN kegagalan —
 *     artinya memang tidak ada iklan otomatis di toko itu.
 *   - Batas laju endpoint Ads jauh lebih ketat daripada Order/Product.
 *     Panggilan keenam dengan jeda 350ms sudah ditolak. Karena itu jeda di
 *     sini 1,5 detik, bukan JEDA_MS, plus mundur bertahap.
 *   - Daftar campaign diurutkan dari yang TERLAMA. Kalau dipotong 100
 *     pertama, yang terbaca campaign mati semua dan biayanya nol.
 */

const JEDA_ADS = 1500;
const MUNDUR = [3000, 8000, 20000];

/** Shopee Ads memakai DD-MM-YYYY. */
const tglShopee = (d) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.day}-${p.month}-${p.year}`;
};
const kunciHari = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);

const angka = (...c) => {
  for (const x of c) {
    const n = Number(x);
    if (Number.isFinite(n) && x !== null && x !== undefined && x !== '') return n;
  }
  return 0;
};

/** "30-07-2026" atau "2026-07-30" → kunci yyyy-mm-dd. */
function bacaTanggal(x) {
  const t = String(x || '').trim();
  let m = t.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Panggil Shopee dengan mundur bertahap KHUSUS batas laju. */
async function panggil(fn) {
  let terakhir = null;
  for (let i = 0; i <= MUNDUR.length; i++) {
    try {
      const hasil = await fn();
      await tidur(JEDA_ADS);
      return hasil;
    } catch (e) {
      terakhir = e;
      const batas = e.kind === 'rate_limit'
        || String(e.shopeeCode || '').includes('rate_limit');
      // Penolakan bisnis tidak diulang — jawabannya tidak akan berubah.
      if (!batas || i === MUNDUR.length) break;
      await tidur(MUNDUR[i]);
    }
  }
  await tidur(JEDA_ADS);
  throw terakhir;
}

function cariArray(obj, kunci, dalam = 0) {
  if (!obj || dalam > 5) return null;
  if (Array.isArray(obj)) {
    return obj.some((x) => x && typeof x === 'object' && kunci in x) ? obj : null;
  }
  if (typeof obj !== 'object') return null;
  for (const v of Object.values(obj)) {
    const hasil = cariArray(v, kunci, dalam + 1);
    if (hasil) return hasil;
  }
  return null;
}

const potong = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Simpan sekumpulan baris. Hari yang ditulis dibersihkan dulu supaya
 *  campaign yang berhenti tidak meninggalkan angka basi. */
async function simpan(shopId, sumber, hariTerpakai, baris) {
  if (!hariTerpakai.length) return 0;
  await q(
    `DELETE FROM ad_spend_item
      WHERE shop_id = $1 AND sumber = $2 AND day = ANY($3::date[])`,
    [shopId, sumber, hariTerpakai]);
  let n = 0;
  for (const b of baris) {
    if (!b.hari || !b.itemId) continue;
    await q(
      `INSERT INTO ad_spend_item (shop_id, day, item_id, sumber, expense, gmv)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (shop_id, day, item_id, sumber)
       DO UPDATE SET expense = ad_spend_item.expense + EXCLUDED.expense,
                     gmv     = ad_spend_item.gmv     + EXCLUDED.gmv`,
      [shopId, b.hari, b.itemId, sumber, b.expense, b.gmv]);
    n++;
  }
  return n;
}

/** ── Jenis 1: Iklan Individual & Grup Iklan ── */
async function tarikIndividu(shopId, token, mulai, akhir) {
  const daftar = await panggil(() => call(EP.adsCampaignList, {
    accessToken: token, shopId,
    params: { ad_type: 'all', offset: 0, limit: 5000 },
  }));
  const ids = (cariArray(daftar.response, 'campaign_id') || []).map((b) => b.campaign_id);
  if (!ids.length) return { baris: 0, campaign: 0 };

  // item_id ada di common_info.item_id_list — sebuah ARRAY, bukan item_id
  // tunggal. Salah baca di sini akan diam-diam menghasilkan nol.
  const petaItem = new Map();
  const hidup = [];
  for (const grup of potong(ids, 100)) {
    const r = await panggil(() => call(EP.adsCampaignSetting, {
      accessToken: token, shopId,
      params: { campaign_id_list: grup.join(','), info_type_list: '1,2,3,4' },
    }));
    for (const b of (cariArray(r.response, 'campaign_id') || [])) {
      const ci = b.common_info || {};
      const items = Array.isArray(ci.item_id_list) ? ci.item_id_list : [];
      petaItem.set(String(b.campaign_id), items);
      // "closed" dilewati; "paused" dan "ended" TETAP ditanyakan, karena
      // campaign yang dijeda kemarin tetap berbelanja tiga hari lalu.
      if (String(ci.campaign_status || '').toLowerCase() !== 'closed') {
        hidup.push(b.campaign_id);
      }
    }
  }
  if (!hidup.length) return { baris: 0, campaign: 0 };

  const baris = [];
  const hariSet = new Set();
  for (const grup of potong(hidup, 100)) {
    const r = await panggil(() => call(EP.adsCampaignDaily, {
      accessToken: token, shopId,
      params: {
        start_date: tglShopee(mulai), end_date: tglShopee(akhir),
        campaign_id_list: grup.join(','),
      },
    }));
    for (const c of (cariArray(r.response, 'metrics_list') || [])) {
      const items = petaItem.get(String(c.campaign_id)) || [];
      if (!items.length) continue;
      for (const m of (c.metrics_list || [])) {
        const hari = bacaTanggal(m.date);
        if (!hari) continue;
        hariSet.add(hari);
        const e = angka(m.expense);
        const g = angka(m.broad_gmv);
        if (!e && !g) continue;
        // Satu campaign satu produk sudah terbukti, tapi kalau suatu saat
        // Shopee mengubahnya, biayanya dibagi rata daripada digandakan ke
        // setiap item — menggandakan akan membuat totalnya melebihi
        // belanja toko dan itu jauh lebih berbahaya.
        for (const it of items) {
          baris.push({ hari, itemId: it, expense: e / items.length, gmv: g / items.length });
        }
      }
    }
  }
  const n = await simpan(shopId, 'individu', [...hariSet], baris);
  return { baris: n, campaign: hidup.length };
}

/** ── Jenis 2: Iklan Produk Otomatis ── */
async function tarikOtomatis(shopId, token, hariList) {
  const baris = [];
  const hariTerisi = [];
  let adaCampaign = false;

  for (const hari of hariList) {
    const tgl = tglShopee(new Date(`${hari}T12:00:00+07:00`));
    let offset = 0;
    let aman = true;
    const kumpul = [];
    for (let putar = 0; putar < 10; putar++) {
      let r;
      try {
        r = await panggil(() => call(EP.adsGmsItem, {
          accessToken: token, shopId,
          body: { start_date: tgl, end_date: tgl, offset, limit: 100 },
        }));
      } catch (e) {
        // Toko tanpa iklan otomatis membalas ini. Bukan kegagalan.
        if (String(e.shopeeCode || '').includes('gms_campaign_not_found')) {
          return { baris: 0, ada: false };
        }
        aman = false;
        break;
      }
      adaCampaign = true;
      const resp = r.response || {};
      const list = cariArray(resp, 'item_id') || [];
      for (const b of list) {
        const e = angka(b?.report?.expense);
        const g = angka(b?.report?.broad_gmv);
        if (!e && !g) continue;
        kumpul.push({ hari, itemId: b.item_id, expense: e, gmv: g });
      }
      if (!resp.has_next_page || !list.length) break;
      offset += 100;
    }
    if (!aman) continue;
    hariTerisi.push(hari);
    baris.push(...kumpul);
  }

  const n = await simpan(shopId, 'otomatis', hariTerisi, baris);
  return { baris: n, ada: adaCampaign };
}

export async function tarikIklanItem(shopId, { hariKeBelakang = 3 } = {}) {
  const token = await tokenHidup(shopId);
  const kini = new Date();
  const mulai = new Date(kini.getTime() - hariKeBelakang * 86400000);

  const hariList = [];
  for (let t = mulai.getTime(); t <= kini.getTime(); t += 86400000) {
    hariList.push(kunciHari(new Date(t)));
  }

  const galat = [];
  let individu = { baris: 0, campaign: 0 };
  let otomatis = { baris: 0, ada: false };

  try {
    individu = await tarikIndividu(shopId, token, mulai, kini);
  } catch (e) {
    if (e.kind === 'rate_limit') throw e;
    galat.push(`individu: ${e.message}`);
  }
  try {
    otomatis = await tarikOtomatis(shopId, token, hariList);
  } catch (e) {
    if (e.kind === 'rate_limit') throw e;
    galat.push(`otomatis: ${e.message}`);
  }

  const total = individu.baris + otomatis.baris;
  await log('iklan-item',
    `Toko ${shopId}: ${individu.baris} baris individu (${individu.campaign} campaign), `
    + `${otomatis.baris} baris otomatis${otomatis.ada ? '' : ' (tidak pakai iklan otomatis)'}`
    + (galat.length ? ` — ${galat[0]}` : ''),
    { shopId, ok: !galat.length });

  if (!total && galat.length) throw new Error(galat[0]);
  return { baris: total, individu: individu.baris, otomatis: otomatis.baris, galat };
}

export async function tarikIklanItemSemua({ hariKeBelakang = 3 } = {}) {
  const toko = await tokoAktif();
  const hasil = [];
  for (const t of toko) {
    try {
      const r = await tarikIklanItem(t.shop_id, { hariKeBelakang });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, ...r, ok: true });
    } catch (e) {
      await log('iklan-item', `Toko ${t.shop_name || t.shop_id} gagal: ${e.message}`,
        { shopId: t.shop_id, ok: false });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, ok: false, error: e.message });
    }
  }
  return hasil;
}
