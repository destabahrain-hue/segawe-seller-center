import { q, one, log } from './db';
import { call, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { tokenHidup } from './tokens';

/**
 * ── Menanggapi permintaan batal dari pembeli ──
 *
 * Ini tindakan paling tidak bisa ditarik kembali di seluruh aplikasi:
 * menyetujui berarti pesanan asli pembeli benar-benar dibatalkan di Shopee,
 * dan tidak ada cara mengembalikannya — di sini maupun di Seller Centre.
 *
 * Karena itu:
 *  - hanya pesanan berstatus IN_CANCEL yang boleh ditanggapi
 *  - satu per satu, tanpa aksi massal
 *  - keputusannya dicatat di Riwayat sistem beserta siapa yang menekan
 */

const SAH = new Set(['ACCEPT', 'REJECT']);

export async function tanggapiBatal(orderId, keputusan, olehNama = null) {
  const aksi = String(keputusan || '').toUpperCase();
  if (!SAH.has(aksi)) throw new Error('Keputusan harus ACCEPT atau REJECT');

  const o = await one(
    `SELECT o.id, o.order_sn, o.shop_id, o.status, o.cancel_reason, s.shop_name
     FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.id = $1`, [orderId]);
  if (!o) throw new Error('Pesanan tidak ditemukan');

  // Penjaga terpenting: status diperiksa dari database TEPAT sebelum kirim.
  // Kalau pembeli menarik permintaannya atau Shopee sudah memutuskan lebih
  // dulu, jangan kirim apa pun.
  if (o.status !== 'IN_CANCEL') {
    throw new Error(
      `Pesanan ${o.order_sn} sudah tidak menunggu keputusan (status ${o.status}). ` +
      `Tekan Sinkron untuk memuat keadaan terbarunya.`);
  }

  const token = await tokenHidup(o.shop_id);
  await call(EP.tanggapiBatal, {
    accessToken: token, shopId: o.shop_id,
    body: { order_sn: o.order_sn, operation: aksi === 'ACCEPT' ? 'ACCEPT' : 'REJECT' },
  });
  await tidur(JEDA_MS);

  // Status sebenarnya datang dari sinkron berikutnya; di sini hanya
  // ditandai supaya tidak tertekan dua kali.
  if (aksi === 'ACCEPT') {
    await q(`UPDATE orders SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`, [o.id]);
  } else {
    await q(`UPDATE orders SET status = 'READY_TO_SHIP' WHERE id = $1`, [o.id]);
  }

  await log('batal',
    `Permintaan batal ${o.order_sn} (${o.shop_name || o.shop_id}) ` +
    `${aksi === 'ACCEPT' ? 'DISETUJUI' : 'DITOLAK'}` +
    (olehNama ? ` oleh ${olehNama}` : '') +
    (o.cancel_reason ? ` — alasan pembeli: ${o.cancel_reason}` : ''),
    { shopId: o.shop_id });

  return { order_sn: o.order_sn, aksi };
}
