import { q, one, log } from './db';
import { call, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { tokenHidup, tokoAktif } from './tokens';

/**
 * ── Penarik biaya iklan harian ──
 *
 * Ini yang bikin kolom "Biaya iklan" selalu Rp 0: tabel ad_spend memang
 * sudah dibaca laporan sejak awal, tapi tidak ada yang pernah mengisinya.
 *
 * Endpoint ads belum pernah kita uji, dan dokumentasi Shopee menyebut nama
 * kolom yang berbeda antar versi. Jadi pembacaannya sengaja longgar:
 * mencari array di mana pun ia berada, lalu mengenali nama kolom dari
 * beberapa kemungkinan. Kalau tetap tidak ketemu, errornya menyertakan
 * bentuk respons aslinya supaya perbaikannya sekali jalan, bukan menebak.
 */

// Shopee Ads memakai DD-MM-YYYY, bukan ISO.
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

/** Cari array berisi baris performa di dalam respons, di kedalaman mana pun. */
function cariBaris(obj, dalam = 0) {
  if (!obj || dalam > 4) return null;
  if (Array.isArray(obj)) {
    // Cocokkan dari POTONGAN nama kolom, bukan nama tepat — Shopee memakai
    // total_expense, ads_expense, dan variasi lain antar versi dokumen.
    const PETUNJUK = ['expense', 'cost', 'spend', 'gmv', 'impression', 'click', 'roi', 'order_amount'];
    const cocok = obj.find((x) => x && typeof x === 'object'
      && Object.keys(x).some((k) => PETUNJUK.some((p) => k.toLowerCase().includes(p))));
    return cocok ? obj : null;
  }
  for (const v of Object.values(obj)) {
    const hasil = cariBaris(v, dalam + 1);
    if (hasil) return hasil;
  }
  return null;
}

/** Ubah "30-07-2026" atau "2026-07-30" jadi kunci yyyy-mm-dd. */
function bacaTanggal(x) {
  const t = String(x || '').trim();
  let m = t.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = Number(t);
  if (Number.isFinite(n) && n > 1e9) return kunciHari(new Date(n * 1000));
  return null;
}

/**
 * Shopee membatasi rentang get_all_cpc_ads_daily_performance MAKSIMAL 1 BULAN
 * per panggilan ("Date range can't be longer than 1 month"). Jadi rentang
 * panjang dipecah jadi potongan 28 hari — dipilih 28, bukan 30, supaya aman
 * terhadap bulan pendek maupun cara Shopee menghitung batasnya.
 */
const POTONG_HARI = 28;

async function tarikSatuPotong(shopId, token, mulai, akhir) {
  const json = await call(EP.adsDaily, {
    accessToken: token, shopId,
    params: { start_date: tglShopee(mulai), end_date: tglShopee(akhir) },
  });

  const baris = cariBaris(json.response);
  if (!baris) {
    const bentuk = JSON.stringify(json.response ?? json).slice(0, 300);
    throw new Error(`Tidak menemukan baris performa iklan. Bentuk respons: ${bentuk}`);
  }

  let simpan = 0;
  for (const b of baris) {
    const hari = bacaTanggal(b.date ?? b.day ?? b.stat_date ?? b.report_date);
    if (!hari) continue;
    const expense = angka(b.expense, b.total_expense, b.ads_expense, b.cost, b.spend);
    const gmv = angka(b.broad_gmv, b.gmv, b.broad_order_amount, b.direct_gmv);
    await q(
      `INSERT INTO ad_spend (shop_id, day, expense, gmv) VALUES ($1,$2,$3,$4)
       ON CONFLICT (shop_id, day) DO UPDATE SET expense = EXCLUDED.expense, gmv = EXCLUDED.gmv`,
      [shopId, hari, expense, gmv]);
    simpan++;
  }
  if (!simpan && baris.length) {
    throw new Error('Baris performa ditemukan tapi tanggalnya tidak terbaca — '
      + `contoh baris: ${JSON.stringify(baris[0]).slice(0, 240)}`);
  }
  return simpan;
}

export async function tarikIklan(shopId, { hariKeBelakang = 3 } = {}) {
  const token = await tokenHidup(shopId);
  const kini = new Date();

  // Susun potongan maju dari tanggal terlama sampai HARI INI.
  // Dihitung maju, bukan mundur: cara mundur menyisakan lubang di ujung
  // sehingga biaya iklan hari ini tidak pernah ikut tertarik.
  const potong = [];
  let a = new Date(kini.getTime() - hariKeBelakang * 86400000);
  while (a.getTime() <= kini.getTime()) {
    const b = new Date(Math.min(a.getTime() + (POTONG_HARI - 1) * 86400000, kini.getTime()));
    potong.push([a, b]);
    a = new Date(b.getTime() + 86400000);
  }

  let total = 0;
  const galat = [];
  for (let i = 0; i < potong.length; i++) {
    const [a, b] = potong[i];
    try {
      total += await tarikSatuPotong(shopId, token, a, b);
    } catch (e) {
      if (e.kind === 'rate_limit') throw e;
      galat.push(`${tglShopee(a)}–${tglShopee(b)}: ${e.message}`);
    }
    if (i < potong.length - 1) await tidur(JEDA_MS);
  }

  // Sebagian berhasil tetap dianggap berhasil — yang gagal dicatat saja.
  if (!total && galat.length) throw new Error(galat[0]);
  if (galat.length) {
    await log('iklan', `Toko ${shopId}: ${total} hari tersimpan, ${galat.length} potongan gagal — ${galat[0]}`,
      { shopId, ok: false });
  } else {
    await log('iklan', `Toko ${shopId}: ${total} hari biaya iklan tersimpan`, { shopId });
  }
  return total;
}

export async function tarikIklanSemua({ hariKeBelakang = 3 } = {}) {
  const toko = await tokoAktif();
  const hasil = [];
  for (const t of toko) {
    try {
      const n = await tarikIklan(t.shop_id, { hariKeBelakang });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, hari: n, ok: true });
    } catch (e) {
      await log('iklan', `Toko ${t.shop_name || t.shop_id} gagal: ${e.message}`,
        { shopId: t.shop_id, ok: false });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, ok: false, error: e.message });
    }
    await tidur(JEDA_MS);
  }
  return hasil;
}

/** Sudah ada data iklan atau belum — dipakai untuk memunculkan ajakan menarik. */
export async function ringkasIklan() {
  return one(`SELECT COUNT(*)::int AS baris, MIN(day) AS terawal, MAX(day) AS terakhir,
                     COALESCE(SUM(expense),0) AS total FROM ad_spend`);
}
