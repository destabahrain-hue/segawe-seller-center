import { q, log } from './db';
import { call, beruntun } from './shopee';
import { EP } from './endpoints';
import { tokenHidup, tokoAktif } from './tokens';

/**
 * ── Tahap 1 modul Logistics: hanya MEMBACA ──
 *
 * Dua endpoint saja, dan tidak satu pun mengubah keadaan pesanan di Shopee:
 *   get_tracking_number — mengisi nomor resi yang selama ini kosong
 *   get_tracking_info   — riwayat perjalanan paket
 *
 * ship_order dan cetak label sengaja belum disentuh: keduanya tindakan nyata
 * yang tidak bisa dibatalkan, dan taruhannya pesanan asli pembeli.
 */

// Status pesanan yang wajar sudah punya resi.
const SUDAH_KIRIM = `('PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','RETRY_SHIP')`;

const ambilResi = (r) =>
  r?.tracking_number || r?.first_mile_tracking_number || r?.plp_number || null;

/**
 * Kapan paket BENAR-BENAR diserahkan ke kurir.
 *
 * Diambil dari langkah PALING AWAL di jejak logistik yang menandai barang
 * sudah berpindah ke jasa kirim. Sengaja yang paling awal: setelah itu
 * jejaknya penuh langkah transit, dan yang dicari adalah momen serah-terima.
 *
 * Polanya dicocokkan ke status maupun keterangan, karena Shopee tidak
 * selalu mengisi logistics_status di tiap langkah.
 */
const POLA_SERAH = /PICKUP_DONE|PICKED_UP|LOGISTICS_PICKUP_DONE|LOGISTICS_REQUEST_CREATED|diserahkan|dijemput|diterima\s+(oleh\s+)?(jasa|pihak)\s*kirim|handed\s*over|picked\s*up/i;

function waktuSerah(jejak) {
  const cocok = jejak
    .filter((x) => x.waktu && POLA_SERAH.test(`${x.status || ''} ${x.catatan || ''}`))
    .map((x) => x.waktu)
    .sort();
  return cocok[0] || null;
}

function ambilJejak(r) {
  const daftar = r?.tracking_info || r?.tracking_list || r?.logistics_tracking_info || [];
  if (!Array.isArray(daftar)) return { status: r?.logistics_status || null, jejak: [] };
  const jejak = daftar.map((x) => ({
    waktu: x.update_time ? new Date(Number(x.update_time) * 1000).toISOString() : null,
    status: x.logistics_status || x.status || null,
    catatan: x.description || x.desc || x.message || null,
  })).filter((x) => x.waktu || x.catatan);
  // Shopee mengirim dari terlama; dibalik supaya yang terbaru di atas.
  jejak.reverse();
  return { status: r?.logistics_status || jejak[0]?.status || null, jejak };
}

/** Isi nomor resi untuk pesanan yang belum punya. */
export async function tarikResi(shopId, { batas = 80 } = {}) {
  const token = await tokenHidup(shopId);
  const perlu = await q(
    `SELECT id, order_sn FROM orders
     WHERE shop_id = $1 AND NULLIF(TRIM(COALESCE(tracking_no,'')),'') IS NULL
       AND status IN ${SUDAH_KIRIM}
     ORDER BY created_time DESC LIMIT $2`, [shopId, batas]);

  let n = 0;
  const galat = [];
  await beruntun(perlu, async (o) => {
    try {
      const json = await call(EP.trackingNumber, {
        accessToken: token, shopId, params: { order_sn: o.order_sn },
      });
      const resi = ambilResi(json.response);
      if (resi) {
        await q('UPDATE orders SET tracking_no = $2 WHERE id = $1', [o.id, resi]);
        n++;
      }
    } catch (e) {
      if (e.kind === 'rate_limit') throw e;
      if (galat.length < 3) galat.push(`${o.order_sn}: ${e.shopeeCode || ''} ${e.message}`.trim());
    }
  });
  if (!n && galat.length) throw new Error(galat[0]);
  return { resi: n, galat };
}

/** Ambil riwayat perjalanan paket untuk pesanan yang sudah punya resi. */
export async function tarikJejak(shopId, { batas = 60, segarJam = 6 } = {}) {
  const token = await tokenHidup(shopId);
  const perlu = await q(
    `SELECT id, order_sn FROM orders
     WHERE shop_id = $1
       AND NULLIF(TRIM(COALESCE(tracking_no,'')),'') IS NOT NULL
       AND status IN ('SHIPPED','TO_CONFIRM_RECEIVE','PROCESSED')
       AND (tracking_at IS NULL OR tracking_at < now() - make_interval(hours => $3))
     ORDER BY created_time DESC LIMIT $2`, [shopId, batas, segarJam]);

  let n = 0;
  const galat = [];
  await beruntun(perlu, async (o) => {
    try {
      const json = await call(EP.trackingInfo, {
        accessToken: token, shopId, params: { order_sn: o.order_sn },
      });
      const { status, jejak } = ambilJejak(json.response);
      const serah = waktuSerah(jejak);

      /**
       * ship_time diperbaiki dari jejak logistik.
       *
       * Nilai dari sinkron pesanan berasal dari `update_time` — waktu
       * pesanan terakhir BERUBAH, bukan waktu barang dikirim. Untuk pesanan
       * yang statusnya masih bergerak, angka itu terus maju dan bisa
       * meleset berhari-hari: pesanan yang diserahkan tanggal 8 tercatat
       * "dikirim" tanggal 11 hanya karena hari itu statusnya berubah lagi.
       *
       * Jejak logistik menyimpan waktu tiap langkah dari kurir, jadi ia
       * sumber yang benar. Yang LEBIH AWAL yang menang — waktu serah-terima
       * tidak mungkin lebih lambat dari yang sudah tercatat.
       */
      await q(
        `UPDATE orders SET tracking_status = $2, tracking_info = $3::jsonb, tracking_at = now(),
                ship_time = CASE
                  WHEN $4::timestamptz IS NULL THEN ship_time
                  WHEN ship_time IS NULL THEN $4::timestamptz
                  ELSE LEAST(ship_time, $4::timestamptz) END
         WHERE id = $1`, [o.id, status, JSON.stringify(jejak), serah]);
      n++;
    } catch (e) {
      if (e.kind === 'rate_limit') throw e;
      if (galat.length < 3) galat.push(`${o.order_sn}: ${e.shopeeCode || ''} ${e.message}`.trim());
    }
  });
  if (!n && galat.length) throw new Error(galat[0]);
  return { jejak: n, galat };
}

export async function tarikLogistikSemua(opsi = {}) {
  const toko = await tokoAktif();
  const hasil = [];
  for (const t of toko) {
    try {
      const a = await tarikResi(t.shop_id, opsi);
      const b = await tarikJejak(t.shop_id, opsi);
      await log('logistik', `Toko ${t.shop_name || t.shop_id}: ${a.resi} resi, ${b.jejak} jejak`,
        { shopId: t.shop_id });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, ...a, ...b, ok: true });
    } catch (e) {
      await log('logistik', `Toko ${t.shop_name || t.shop_id} gagal: ${e.message}`,
        { shopId: t.shop_id, ok: false });
      hasil.push({ shopId: String(t.shop_id), nama: t.shop_name || null, ok: false, error: e.message });
    }
  }
  return hasil;
}
