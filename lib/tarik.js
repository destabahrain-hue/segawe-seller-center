import { q, one } from './db';
import { antrikan } from './queue';

/**
 * ── Penarikan data per toko ──
 *
 * Semua penarikan (produk, pesanan, iklan) dijadikan TUGAS ANTREAN, bukan
 * dikerjakan langsung di dalam permintaan HTTP. Dua alasan:
 *
 *  1. Penarikan awal satu toko bisa ratusan panggilan. Dikerjakan sekaligus,
 *     halamannya menggantung dan Shopee melihat lonjakan mendadak — itu yang
 *     dulu memicu peringatan "Abnormal Order API call" di Security Dashboard
 *     ketika NSC dan Segawe pertama disambungkan.
 *  2. Antrean sudah punya jeda per toko, mundur saat kena batas laju, dan
 *     penyapu tugas yang tersangkut.
 *
 * Kemajuannya dihitung dari sisa tugas di antrean, jadi layar bisa
 * menunjukkan "Pesanan: 5 dari 7 potongan" tanpa menebak-nebak.
 */

const HARI_AWAL = 90;              // penarikan otomatis saat toko baru dihubungkan
const POTONG_PESANAN = 14;         // batas rentang get_order_list per panggilan
const BAGIAN = ['produk', 'pesanan', 'iklan'];

/** Antrikan satu bagian. `hari` hanya berlaku untuk pesanan & iklan. */
export async function antrikanTarik(shopId, bagian, { hari = HARI_AWAL } = {}) {
  if (!BAGIAN.includes(bagian)) throw new Error(`Bagian tidak dikenal: ${bagian}`);
  const n = Math.min(Math.max(Number(hari) || HARI_AWAL, 1), 730);

  if (bagian === 'produk') {
    await antrikan('tarik_produk', { shopId, payload: {} });
    return { tugas: 1 };
  }

  if (bagian === 'iklan') {
    await antrikan('tarik_iklan', { shopId, payload: { hari: n } });
    return { tugas: 1, hari: n };
  }

  // Pesanan dipotong per 14 hari — batas rentang get_order_list.
  const kini = Math.floor(Date.now() / 1000);
  const mulai = kini - n * 86400;
  let tugas = 0;
  for (let a = mulai; a < kini; a += POTONG_PESANAN * 86400) {
    const b = Math.min(a + POTONG_PESANAN * 86400, kini);
    await antrikan('tarik_riwayat', { shopId, payload: { dari: a, sampai: b } });
    tugas++;
  }
  return { tugas, hari: n };
}

/**
 * Penarikan awal toko baru. Urutannya disengaja: produk lebih dulu (paling
 * ringan, dan dibutuhkan untuk menautkan SKU), lalu pesanan, lalu iklan.
 * Escrow dan retur tidak perlu diantrikan — penjadwal menyapunya sendiri
 * begitu pesanannya ada.
 */
export async function tarikAwal(shopId, { hari = HARI_AWAL } = {}) {
  const hasil = {};
  for (const bagian of BAGIAN) hasil[bagian] = await antrikanTarik(shopId, bagian, { hari });
  await q(`UPDATE shops SET tarik_awal_at = now() WHERE shop_id = $1`, [shopId]).catch(() => {});
  return hasil;
}

/**
 * Kemajuan penarikan per toko, untuk bilah di halaman Toko Terhubung.
 *
 * "selesai" dihitung dari tugas yang sudah keluar dari antrean, bukan dari
 * jumlah baris yang masuk — jumlah baris tidak pernah diketahui di muka
 * karena Shopee mengirim per halaman tanpa memberi tahu totalnya.
 */
export async function statusTarik(shopId) {
  const antre = await q(`
    SELECT kind,
           COUNT(*) FILTER (WHERE status IN ('pending','running'))::int AS sisa,
           COUNT(*) FILTER (WHERE status = 'running')::int              AS jalan,
           COUNT(*) FILTER (WHERE status = 'done'
                              AND created_at > now() - interval '2 days')::int AS selesai_baru,
           COUNT(*) FILTER (WHERE status = 'error'
                              AND created_at > now() - interval '2 days')::int AS gagal
      FROM jobs
     WHERE shop_id = $1 AND kind IN ('tarik_produk','tarik_riwayat','tarik_iklan')
     GROUP BY kind`, [shopId]);

  const per = Object.fromEntries(antre.map((r) => [r.kind, r]));
  const isi = await one(`
    SELECT (SELECT COUNT(*) FROM products p WHERE p.shop_id = $1)::int      AS produk,
           (SELECT MAX(synced_at) FROM products p WHERE p.shop_id = $1)     AS produk_at,
           (SELECT COUNT(*) FROM orders o WHERE o.shop_id = $1)::int        AS pesanan,
           (SELECT MIN(created_time) FROM orders o WHERE o.shop_id = $1)    AS pesanan_terawal,
           (SELECT MAX(created_time) FROM orders o WHERE o.shop_id = $1)    AS pesanan_terakhir,
           (SELECT COUNT(*) FROM returns r WHERE r.shop_id = $1)::int       AS retur,
           (SELECT MIN(day) FROM ad_spend a WHERE a.shop_id = $1)           AS iklan_terawal,
           (SELECT MAX(day) FROM ad_spend a WHERE a.shop_id = $1)           AS iklan_terakhir,
           (SELECT COUNT(*) FROM order_escrow e JOIN orders o ON o.id = e.order_id
             WHERE o.shop_id = $1 AND COALESCE(e.escrow_amount,0) > 0)::int AS escrow`, [shopId]);

  const bagian = (kind, extra) => {
    const a = per[kind] || {};
    const sisa = Number(a.sisa) || 0;
    const selesai = Number(a.selesai_baru) || 0;
    const total = sisa + selesai;
    return {
      sisa, jalan: Number(a.jalan) || 0, gagal: Number(a.gagal) || 0,
      total, selesai,
      persen: total ? Math.round((selesai / total) * 100) : (sisa ? 0 : 100),
      berjalan: sisa > 0,
      ...extra,
    };
  };

  const p = {
    produk:  bagian('tarik_produk',  { jumlah: isi.produk, terakhir: isi.produk_at }),
    pesanan: bagian('tarik_riwayat', { jumlah: isi.pesanan, terawal: isi.pesanan_terawal,
                                       terakhir: isi.pesanan_terakhir }),
    iklan:   bagian('tarik_iklan',   { terawal: isi.iklan_terawal, terakhir: isi.iklan_terakhir }),
  };
  return { ...p, retur: isi.retur, escrow: isi.escrow,
           berjalan: BAGIAN.some((b) => p[b].berjalan) };
}

/** Semua toko sekaligus — dipakai halaman Toko Terhubung saat dimuat. */
export async function statusTarikSemua() {
  const toko = await q(`SELECT shop_id FROM shops ORDER BY shop_id`);
  const hasil = {};
  for (const t of toko) hasil[String(t.shop_id)] = await statusTarik(t.shop_id);
  return hasil;
}
