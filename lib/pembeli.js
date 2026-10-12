import crypto from 'node:crypto';
import { q, one } from './db';

/**
 * ── Sidik pembeli & pembersihan data pribadi ──
 *
 * Kebijakan Perlindungan Data Shopee Open Platform melarang menyimpan data
 * pribadi pembeli lebih lama dari yang diperlukan, dan dalam kondisi apa
 * pun tidak lebih dari 90 hari. Yang dibersihkan di sini: nama penerima,
 * telepon, alamat, kecamatan, kode pos, pesan pembeli, dan jejak kurir
 * (jejak sering memuat "diterima oleh <nama>").
 *
 * Kolom alamat tetap dikosongkan walau untuk app ini isinya sudah "****"
 * dari Shopee (dibuktikan lewat /api/diagnosa-alamat). Kalau suatu saat
 * akses data sensitif diberikan, isinya jadi sungguhan dan pembersihan ini
 * langsung berlaku tanpa perlu diubah.
 *
 * USERNAME juga dipertahankan — keputusan Prima, 28 Sep 2026. Kalau nanti
 * berubah pikiran, nyalakan HAPUS_USERNAME_90H=1 di environment; tidak ada
 * kode yang perlu diubah, dan halaman pelanggan otomatis beralih memakai
 * kode pelanggan untuk pembeli lama.
 *
 * Analisa pelanggan TIDAK bergantung pada kolom-kolom itu: semua
 * pengelompokan memakai pembeli_id, yang tidak pernah dihapus.
 */

const HARI = () => Math.max(Number(process.env.SIMPAN_PRIBADI_HARI) || 90, 1);
const HAPUS_USERNAME = () => process.env.HAPUS_USERNAME_90H === '1';

/**
 * Kunci sidik. APP_SESSION_TOKEN dipakai sebagai cadangan karena sudah
 * pasti ada dan tidak pernah diganti; kalau diganti, sidik lama tidak akan
 * cocok dengan yang baru dan riwayat pelanggan terputus — karena itu
 * PEMBELI_SALT sebaiknya diisi sendiri dan dibiarkan selamanya.
 */
function kunci() {
  const k = process.env.PEMBELI_SALT || process.env.APP_SESSION_TOKEN || '';
  return k.length >= 8 ? k : null;
}

/**
 * Sidik satu arah, dipisah per TOKO.
 *
 * Username Shopee berbeda per toko untuk orang yang sama, dan menyatukan
 * pembeli lintas toko juga bukan hak kita. Memasukkan shop_id ke dalam
 * sidik membuat itu tidak mungkin terjadi walau kebetulan usernamenya sama.
 */
export function sidikPembeli(shopId, username) {
  const k = kunci();
  const u = String(username || '').trim().toLowerCase();
  if (!k || !u) return null;
  return crypto.createHmac('sha256', k).update(`${shopId}|${u}`).digest('hex').slice(0, 24);
}

/**
 * Isi pembeli_id untuk pesanan lama yang belum punya.
 *
 * WAJIB tuntas sebelum pembersihan berjalan — kalau username dihapus lebih
 * dulu, pesanan itu tidak akan pernah bisa dikelompokkan lagi. Pembersihan
 * di bawah juga menolak menyentuh baris yang pembeli_id-nya masih kosong,
 * jadi urutannya terjaga sendiri.
 */
export async function isiPembeliId({ batas = 2000 } = {}) {
  if (!kunci()) return { ok: false, alasan: 'kunci sidik belum ada', terisi: 0 };
  const rows = await q(
    `SELECT id, shop_id, buyer_username FROM orders
      WHERE pembeli_id IS NULL AND buyer_username IS NOT NULL
      ORDER BY id DESC LIMIT $1`, [batas]);
  let n = 0;
  for (const r of rows) {
    const sidik = sidikPembeli(r.shop_id, r.buyer_username);
    if (!sidik) continue;
    await q(`UPDATE orders SET pembeli_id = $2 WHERE id = $1`, [r.id, sidik]);
    n++;
  }
  const [sisa] = await q(
    `SELECT COUNT(*)::int AS n FROM orders WHERE pembeli_id IS NULL AND buyer_username IS NOT NULL`);
  return { ok: true, terisi: n, sisa: sisa?.n || 0 };
}

/** Sama untuk tabel retur. */
export async function isiPembeliIdRetur({ batas = 2000 } = {}) {
  if (!kunci()) return { ok: false, terisi: 0 };
  const rows = await q(
    `SELECT return_sn, shop_id, buyer_username FROM returns
      WHERE pembeli_id IS NULL AND buyer_username IS NOT NULL LIMIT $1`, [batas]);
  let n = 0;
  for (const r of rows) {
    const sidik = sidikPembeli(r.shop_id, r.buyer_username);
    if (!sidik) continue;
    await q(`UPDATE returns SET pembeli_id = $2 WHERE return_sn = $1`, [r.return_sn, sidik]);
    n++;
  }
  return { ok: true, terisi: n };
}

/**
 * Hapus data pribadi pesanan yang lebih tua dari batas simpan.
 *
 * Dikerjakan bertahap (bawaan 5.000 baris per jalan) supaya tidak mengunci
 * tabel orders lama-lama di tengah jam sibuk.
 */
export async function bersihkanPrivasi({ batas = 5000 } = {}) {
  const hari = HARI();
  const rows = await q(
    `UPDATE orders o SET
       recipient_name = NULL, phone = NULL, address = NULL,
       district = NULL, zipcode = NULL, buyer_message = NULL,
       tracking_info = NULL,
       buyer_username = CASE WHEN $2 THEN NULL ELSE o.buyer_username END,
       privasi_bersih_at = now()
     WHERE o.id IN (
       SELECT id FROM orders
        WHERE privasi_bersih_at IS NULL
          AND created_time < now() - make_interval(days => $1)
          -- Jangan sentuh yang sidiknya belum terisi: menghapus username
          -- lebih dulu akan memutus riwayat pelanggan selamanya.
          AND (pembeli_id IS NOT NULL OR buyer_username IS NULL)
        ORDER BY created_time
        LIMIT $3)
     RETURNING o.id`, [hari, HAPUS_USERNAME(), batas]);

  const ret = await q(
    `UPDATE returns r SET
       mentah = NULL, dispute_text = NULL, images = NULL,
       buyer_username = CASE WHEN $2 THEN NULL ELSE r.buyer_username END,
       privasi_bersih_at = now()
     WHERE r.privasi_bersih_at IS NULL
       AND r.create_time < now() - make_interval(days => $1)
       AND (r.pembeli_id IS NOT NULL OR r.buyer_username IS NULL)
     RETURNING r.return_sn`, [hari, HAPUS_USERNAME()]);

  const [sisa] = await q(
    `SELECT COUNT(*)::int AS n FROM orders
      WHERE privasi_bersih_at IS NULL AND created_time < now() - make_interval(days => $1)`, [hari]);

  return { pesanan: rows.length, retur: ret.length, sisa: sisa?.n || 0, hari, usernameIkut: HAPUS_USERNAME() };
}

/** Ringkasan untuk halaman/diagnosa: seberapa jauh kepatuhan sudah berjalan. */
export async function statusPrivasi() {
  return one(`
    SELECT
      (SELECT COUNT(*) FROM orders)::int                                              AS pesanan,
      (SELECT COUNT(*) FROM orders WHERE pembeli_id IS NOT NULL)::int                 AS bersidik,
      (SELECT COUNT(*) FROM orders WHERE pembeli_id IS NULL
                                     AND buyer_username IS NOT NULL)::int             AS belum_bersidik,
      (SELECT COUNT(*) FROM orders WHERE privasi_bersih_at IS NOT NULL)::int          AS sudah_dibersihkan,
      (SELECT COUNT(*) FROM orders
        WHERE privasi_bersih_at IS NULL
          AND created_time < now() - make_interval(days => $1))::int                  AS menunggu_dibersihkan,
      (SELECT COUNT(*) FROM orders
        WHERE created_time < now() - make_interval(days => $1)
          AND (phone IS NOT NULL OR address IS NOT NULL
               OR recipient_name IS NOT NULL))::int                                   AS masih_punya_data_pribadi
  `, [HARI()]);
}
