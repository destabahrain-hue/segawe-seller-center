import { q, one, log } from './db';

/**
 * ── Potong stok gudang untuk pesanan TikTok yang terkirim ──
 *
 * Kembaran potongStokTerkirim() Shopee di lib/sync.js: satu gudang fisik,
 * stok dipotong saat pesanan DIKIRIM (dijemput kurir), paket bundling
 * diuraikan ke komponennya, dan jumlah per Master SKU dikumpulkan dulu per
 * pesanan sebelum disimpan (pelajaran Shopee: tanpa itu potongan barang yang
 * muncul dua kali dalam satu pesanan hilang diam-diam).
 *
 * TANGGAL MULAI. Sampai paket ini, keluar TikTok dicatat MANUAL di Gudang
 * (jenis "TikTok Shop"). Kalau pesanan lama ikut dipotong otomatis, stok
 * akan terpotong dua kali. Jadi hanya pesanan yang dikirim SEJAK tanggal
 * mulai yang dipotong — tanggal itu dicatat sekali saat fungsi ini pertama
 * jalan (baris jadwal 'tiktok_stok_mulai'), atau dipaku lewat env
 * TIKTOK_STOK_MULAI=YYYY-MM-DD. Sejak tanggal itu, keluar TikTok TIDAK
 * perlu dicatat manual lagi.
 */

const TERKIRIM = ['PARTIALLY_SHIPPING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

export async function tanggalMulaiStokTiktok() {
  const env = process.env.TIKTOK_STOK_MULAI;
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) {
    return new Date(`${env}T00:00:00+07:00`);
  }
  await q(`INSERT INTO jadwal (nama, last_run, last_note) VALUES ('tiktok_stok_mulai', now(),
             'Potong stok TikTok otomatis mulai berlaku')
           ON CONFLICT (nama) DO NOTHING`);
  const r = await one(`SELECT last_run FROM jadwal WHERE nama = 'tiktok_stok_mulai'`);
  return r?.last_run ? new Date(r.last_run) : new Date();
}

export async function potongStokTiktok({ batas = 1000 } = {}) {
  const mulai = await tanggalMulaiStokTiktok();
  const pesanan = await q(`
    SELECT o.order_id, o.shop_id,
           COALESCE(o.collection_time, o.rts_time, o.update_time) AS waktu_kirim
      FROM tiktok_orders o
     WHERE o.stok_applied = false
       AND o.status = ANY($1::text[])
       AND COALESCE(o.collection_time, o.rts_time, o.update_time) >= $2
     ORDER BY 3
     LIMIT $3`, [TERKIRIM, mulai, batas]);

  let dipotong = 0, tanpaTaut = 0;
  for (const p of pesanan) {
    // TikTok menyimpan SATU BARIS PER UNIT, jadi qty = jumlah baris.
    const barang = await q(`
      SELECT i.seller_sku, COUNT(*)::int AS qty, m.master_sku_id, ms.kind
        FROM tiktok_order_items i
        LEFT JOIN tiktok_sku_mapping m ON m.shop_id = i.shop_id AND m.seller_sku = i.seller_sku
        LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
       WHERE i.order_id = $1
       GROUP BY i.seller_sku, m.master_sku_id, ms.kind`, [p.order_id]);
    if (!barang.length) continue;   // barangnya belum tertarik — coba lagi putaran berikutnya

    const perMaster = new Map();
    for (const b of barang) {
      if (!b.master_sku_id) { tanpaTaut++; continue; }
      const daun = b.kind === 'paket'
        ? await q('SELECT child_id AS id, qty FROM master_sku_component WHERE parent_id = $1', [b.master_sku_id])
        : [{ id: b.master_sku_id, qty: 1 }];
      for (const d of daun) {
        const k = String(d.id);
        perMaster.set(k, (perMaster.get(k) || 0) + b.qty * d.qty);
      }
    }
    for (const [masterId, qty] of perMaster) {
      await q(`
        INSERT INTO stock_moves (master_sku_id, direction, qty, ref_type, ref_id, note, moved_at, jenis)
        VALUES ($1,'out',$2,'tiktok_order',$3,$4, COALESCE($5::timestamptz, now()), 'tiktok')
        ON CONFLICT (ref_type, ref_id, master_sku_id) WHERE ref_type = 'tiktok_order'
        DO UPDATE SET qty = EXCLUDED.qty, moved_at = EXCLUDED.moved_at`,
        [masterId, qty, p.order_id, `Pesanan TikTok ${p.order_id}`, p.waktu_kirim]);
    }
    await q(`UPDATE tiktok_orders SET stok_applied = true WHERE order_id = $1`, [p.order_id]);
    dipotong++;
  }
  if (tanpaTaut) {
    await log('stok', `${tanpaTaut} baris pesanan TikTok terkirim tidak dipotong stoknya `
      + `karena SKU-nya belum tertaut ke Master SKU`, { ok: false });
  }
  return { dipotong, tanpaTaut, mulai };
}
