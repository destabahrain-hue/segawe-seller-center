import { q, one, log } from './db';
import { tidur, bisaDiulang, jenisGagalPack } from './shopee';
import { JEDA_MS } from './endpoints';
import { call } from './shopee';
import { EP } from './endpoints';
import { tokenHidup } from './tokens';

/** Masukkan tugas ke antrean. Tidak langsung dikerjakan. */
export async function antrikan(kind, { shopId = null, payload = {}, totalSteps = 1 } = {}) {
  return one(
    `INSERT INTO jobs (kind, shop_id, payload, total_steps) VALUES ($1,$2,$3,$4) RETURNING *`,
    [kind, shopId, JSON.stringify(payload), totalSteps]);
}

const PENANGAN = {
  // Satu pesanan per tugas. ship_order tidak bisa dibatalkan, jadi tiap
  // pesanan dikerjakan sendiri-sendiri: satu kegagalan tidak menyeret
  // yang lain, dan sisanya tetap jalan.
  async pack_pesanan(job) {
    const { packSatu } = await import('./kirim');
    const p = job.payload;
    await packSatu(job.shop_id, p.order_sn, p.pilihan);
  },

  // Satu potongan riwayat per tugas (maksimal 14 hari, batas Shopee).
  async tarik_riwayat(job) {
    const { tarikRiwayat } = await import('./sync');
    const p = job.payload;
    await tarikRiwayat(job.shop_id, Number(p.dari), Number(p.sampai));
  },

  // ── TikTok Shop ──
  // Satu tugas = satu jendela 7 hari. Dipecah kecil supaya tiap tugas
  // selesai jauh di dalam anggaran waktu antrean, dan kalau satu jendela
  // gagal (batas laju, jaringan), hanya jendela itu yang diulang.
  async tiktok_pesanan(job) {
    const { tarikPesananTiktok } = await import('./tiktok-sync');
    const p = job.payload || {};
    await tarikPesananTiktok(p.shop_id, {
      dari: new Date(Number(p.dari) * 1000),
      sampai: new Date(Number(p.sampai) * 1000),
      detik: 40,
    });
  },

  async tiktok_statement(job) {
    const { tarikStatementTiktok } = await import('./tiktok-sync');
    await tarikStatementTiktok(job.payload?.shop_id, { detik: 40 });
  },

  /**
   * Transaksi per statement — sumber Laporan Keuangan TikTok. Satu tugas
   * bekerja sampai anggaran waktunya habis, lalu MENGANTRIKAN DIRINYA LAGI
   * kalau masih ada statement yang belum ditarik — jadi riwayat panjang
   * tuntas sendiri tanpa ditekan berulang kali.
   */
  async tiktok_transaksi(job) {
    const { tarikTransaksiTiktok } = await import('./tiktok-keuangan');
    const shopId = job.payload?.shop_id;
    const r = await tarikTransaksiTiktok(shopId, { detik: 40 });
    // Tidak ada satu pun yang berhasil DAN ada galat: tugas ini GAGAL, dan
    // pesannya tampil di halaman Antrean — bukan "selesai" dengan 0 baris.
    if (r.galat && r.statement === 0) throw new Error(r.galat);
    const putaran = Number(job.payload?.putaran || 0);
    if (r.sisa > 0 && (r.statement > 0 || putaran < 3) && putaran < 400) {
      await antrikan('tiktok_transaksi', { payload: { shop_id: shopId, putaran: putaran + 1 } });
    }
  },

  async tiktok_retur(job) {
    const { tarikReturTiktok } = await import('./tiktok-sync');
    await tarikReturTiktok(job.payload?.shop_id);
  },

  // Katalog satu toko. Berat tapi jarang, jadi satu tugas per toko.
  async tarik_produk(job) {
    const { tarikProduk } = await import('./sync');
    await tarikProduk(job.shop_id);
  },

  // Biaya iklan satu toko. Dipotong 28 hari per panggilan di dalam
  // tarikIklan; batas laju endpoint Ads jauh lebih ketat dari yang lain,
  // jadi tetap satu tugas supaya jedanya terjaga.
  async tarik_iklan(job) {
    const { tarikIklan } = await import('./iklan');
    await tarikIklan(job.shop_id, { hariKeBelakang: Number(job.payload?.hari) || 90 });
  },

  // Satu tugas = satu produk disalin. Berat (unggah beberapa gambar),
  // jadi sengaja tidak digabung supaya jeda antar panggilan tetap terjaga.
  async salin_produk(job) {
    const { salinProduk } = await import('./salin');
    const p = job.payload;
    await salinProduk({ dariShop: p.dari, keShop: job.shop_id, itemId: p.item_id });
  },

  // Ubah harga satu produk (satu tugas = satu panggilan, supaya jeda terjaga)
  async ubah_harga(job) {
    const token = await tokenHidup(job.shop_id);
    const p = job.payload;
    await call(EP.updatePrice, {
      accessToken: token, shopId: job.shop_id,
      body: { item_id: Number(p.item_id), price_list: p.price_list },
    });
  },
  async ubah_stok(job) {
    const token = await tokenHidup(job.shop_id);
    const p = job.payload;
    await call(EP.updateStock, {
      accessToken: token, shopId: job.shop_id,
      body: { item_id: Number(p.item_id), stock_list: p.stock_list },
    });
  },
};

/**
 * Kerjakan antrean sebentar saja lalu berhenti — dipanggil berkala
 * oleh cron. Selalu ada jeda antar panggilan; tidak pernah borongan.
 */
export async function jalankanAntrean({ maks = 25, budgetMs = 20000 } = {}) {
  const mulai = Date.now();

  /**
   * Tugas yang tersangkut di status 'running' dikembalikan dulu.
   *
   * Sejak tugas diambil serombongan (lihat di bawah), proses yang mati di
   * tengah jalan bisa meninggalkan beberapa tugas berstatus 'running'
   * selamanya. Lima menit jauh lebih lama dari tugas terlama yang wajar,
   * jadi apa pun yang masih 'running' setelah itu memang sudah yatim.
   */
  await q(`UPDATE jobs SET status = 'pending'
            WHERE status = 'running' AND started_at < now() - interval '5 minutes'`)
    .catch(() => {});

  /**
   * ── Kenapa dikerjakan per toko secara bersamaan ──
   *
   * Batas laju Shopee dihitung PER TOKO. Mengerjakan tugas satu per satu
   * lintas toko berarti menjumlahkan waktu delapan toko tanpa melindungi
   * apa pun. Untuk 100 pesanan yang tersebar di banyak toko, itu bedanya
   * menit dengan puluhan detik.
   *
   * Di dalam satu toko tetap berurutan dengan jeda — di situlah batas
   * lajunya benar-benar berlaku.
   */
  const jobs = await q(`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_after <= now()
      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING *`, [maks]);
  if (!jobs.length) return { selesai: 0, gagal: 0 };

  const perToko = new Map();
  for (const j of jobs) {
    const k = String(j.shop_id || 'tanpa-toko');
    if (!perToko.has(k)) perToko.set(k, []);
    perToko.get(k).push(j);
  }

  let selesai = 0, gagal = 0;
  const sisa = [];

  await Promise.all([...perToko.values()].map(async (antre) => {
    for (const job of antre) {
      // Kalau waktunya habis, sisanya dikembalikan ke antrean — bukan
      // dijalankan setengah-setengah atau dibiarkan menggantung 'running'.
      if (Date.now() - mulai > budgetMs) { sisa.push(job.id); continue; }

      const fn = PENANGAN[job.kind];
      if (!fn) {
        await q(`UPDATE jobs SET status='failed', last_error=$2, finished_at=now() WHERE id=$1`,
          [job.id, `Jenis tugas tidak dikenal: ${job.kind}`]);
        gagal++; continue;
      }

      try {
        await fn(job);
        await q(`UPDATE jobs SET status='done', done_steps=total_steps, finished_at=now() WHERE id=$1`,
          [job.id]);
        selesai++;
      } catch (e) {
        const kenaBatas = e.kind === 'rate_limit' && job.attempts < 15;
        const menyerah = !bisaDiulang(e) || (job.attempts >= 4 && !kenaBatas);
        const pesan = String(e.message || e).slice(0, 500);

        await q(`UPDATE jobs SET status=$2, last_error=$3,
                        run_after = now() + ($4 || ' seconds')::interval,
                        finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
                  WHERE id=$1`,
          [job.id, menyerah ? 'failed' : 'pending', pesan, menyerah ? 0 : (kenaBatas ? 120 : 30)]);

        if (menyerah) {
          gagal++;
          await log('antrean', `Tugas ${job.id} menyerah: ${e.message}`, { ok: false });
          // Keadaan gagal ditempelkan ke PESANANNYA, bukan cuma ke tugas.
          if (job.kind === 'pack_pesanan' && job.payload?.order_sn) {
            await q(`
              UPDATE orders
                 SET pack_gagal_at = now(), pack_gagal_jenis = $3,
                     pack_gagal_kode = $4, pack_gagal_pesan = $5
               WHERE shop_id = $1 AND order_sn = $2`,
              [job.shop_id, job.payload.order_sn, jenisGagalPack(e),
               String(e.shopeeCode || '').slice(0, 120), String(e.message || '').slice(0, 500)])
              .catch(() => {});
          }
        }
      }
    }
  }));

  if (sisa.length) {
    await q(`UPDATE jobs SET status='pending', attempts = GREATEST(attempts - 1, 0)
              WHERE id = ANY($1::bigint[])`, [sisa]).catch(() => {});
  }

  return { selesai, gagal, dikembalikan: sisa.length };
}

