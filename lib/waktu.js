import { q, one } from './db';

/**
 * ── Penjualan per waktu ──
 *
 * Menjawab "kapan pembeli belanja" dan "berapa yang batal", bukan berapa
 * labanya. Semua pengelompokan memakai kalender WIB.
 *
 * Istilah yang dipakai konsisten dengan halaman lain:
 *   GMV      = seluruh nilai pesanan, TERMASUK yang batal
 *   Net GMV  = pesanan sah saja (bukan CANCELLED / UNPAID)
 * Keduanya dari harga barang (qty x price), bukan orders.total_amount,
 * supaya cocok dengan omzet di Laporan Toko.
 *
 * Tanggal memakai waktu pesanan DIBUAT; jam belanja memakai waktu DIBAYAR
 * (kalau belum ada, waktu dibuat) — itu yang paling dekat dengan "kapan
 * pembeli menekan bayar", dan berguna untuk menyetel jadwal iklan.
 */

const SAH = `o.status NOT IN ('CANCELLED','UNPAID')`;
const WIB = `AT TIME ZONE 'Asia/Jakarta'`;
const NILAI = `(SELECT COALESCE(SUM(oi.qty * oi.price), 0) FROM order_items oi WHERE oi.order_id = o.id)`;
const UNIT  = `(SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi WHERE oi.order_id = o.id)`;

export const SEGMEN = [
  ['Dini Hari', 0, 3], ['Pagi Awal', 4, 7], ['Jam Kerja', 8, 11],
  ['Makan Siang', 12, 13], ['Sore', 14, 17], ['Prime Time', 18, 21], ['Malam', 22, 23],
];

export async function laporanWaktu({ dari, sampai, shopId = null } = {}) {
  const toko = shopId ? ' AND o.shop_id = $3' : '';
  const p = shopId ? [dari, sampai, shopId] : [dari, sampai];
  const rentang = `o.created_time >= $1 AND o.created_time < $2${toko}`;

  const [kartu, harian, jam, alasan, pola, retur] = await Promise.all([
    one(`
      SELECT COUNT(*)::int                                          AS pesanan,
             COUNT(*) FILTER (WHERE ${SAH})::int                    AS pesanan_sah,
             COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int    AS batal,
             COALESCE(SUM(${NILAI}), 0)                             AS gmv,
             COALESCE(SUM(${NILAI}) FILTER (WHERE ${SAH}), 0)       AS net_gmv,
             COALESCE(SUM(${NILAI}) FILTER (WHERE o.status = 'CANCELLED'), 0) AS nilai_batal,
             COALESCE(SUM(${UNIT}) FILTER (WHERE ${SAH}), 0)::int   AS produk
        FROM orders o WHERE ${rentang}`, p),

    q(`
      SELECT (o.created_time ${WIB})::date                          AS tanggal,
             COUNT(*)::int                                          AS pesanan,
             COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int    AS batal,
             COALESCE(SUM(${NILAI}) FILTER (WHERE o.status = 'CANCELLED'), 0) AS nilai_batal,
             COALESCE(SUM(${NILAI}), 0)                             AS gmv,
             COALESCE(SUM(${NILAI}) FILTER (WHERE ${SAH}), 0)       AS penjualan,
             COALESCE(SUM(${UNIT}) FILTER (WHERE ${SAH}), 0)::int   AS produk
        FROM orders o WHERE ${rentang}
       GROUP BY 1 ORDER BY 1`, p),

    q(`
      SELECT EXTRACT(HOUR FROM (COALESCE(o.paid_at, o.created_time) ${WIB}))::int AS jam,
             COUNT(*)::int                                        AS pesanan,
             COALESCE(SUM(${UNIT}), 0)::int                       AS produk,
             COALESCE(SUM(${NILAI}), 0)                           AS penjualan
        FROM orders o WHERE ${rentang} AND ${SAH}
       GROUP BY 1 ORDER BY 1`, p),

    q(`
      SELECT COALESCE(NULLIF(TRIM(o.cancel_reason), ''), 'Alasan tidak dicantumkan') AS alasan,
             o.cancel_by                                          AS oleh,
             COUNT(*)::int                                        AS pesanan,
             COALESCE(SUM(${NILAI}), 0)                           AS nilai
        FROM orders o
       WHERE ${rentang} AND o.status = 'CANCELLED'
       GROUP BY 1, 2 ORDER BY pesanan DESC LIMIT 15`, p),

    q(`
      SELECT EXTRACT(ISODOW FROM (o.created_time ${WIB}))::int     AS hari,
             LEAST(CEIL(EXTRACT(DAY FROM (o.created_time ${WIB})) / 7.0), 5)::int AS minggu,
             CASE WHEN EXTRACT(DAY FROM (o.created_time ${WIB})) <= 10 THEN 1
                  WHEN EXTRACT(DAY FROM (o.created_time ${WIB})) <= 20 THEN 2
                  ELSE 3 END                                      AS sepertiga,
             COALESCE(SUM(${UNIT}), 0)::int                        AS produk,
             COUNT(*)::int                                         AS pesanan
        FROM orders o WHERE ${rentang} AND ${SAH}
       GROUP BY 1, 2, 3`, p),

    one(`
      SELECT COUNT(*)::int AS jumlah, COALESCE(SUM(r.refund_amount), 0) AS nilai
        FROM returns r
       WHERE r.create_time >= $1 AND r.create_time < $2${shopId ? ' AND r.shop_id = $3' : ''}`, p),
  ]);

  // Kelompokkan pola jadi tiga tabel siap tampil.
  const jumlahkan = (kunci) => {
    const peta = new Map();
    for (const r of pola) {
      const k = r[kunci];
      peta.set(k, (peta.get(k) || 0) + r.produk);
    }
    const total = [...peta.values()].reduce((a, b) => a + b, 0) || 1;
    return [...peta.entries()]
      .map(([k, v]) => ({ kunci: k, produk: v, porsi: (v / total) * 100 }))
      .sort((a, b) => b.produk - a.produk);
  };

  const perJam = Array.from({ length: 24 }, (_, i) => {
    const r = jam.find((x) => x.jam === i);
    return { jam: i, pesanan: r?.pesanan || 0, produk: r?.produk || 0,
             penjualan: Number(r?.penjualan) || 0 };
  });
  const totalProdukJam = perJam.reduce((a, x) => a + x.produk, 0) || 1;
  const segmen = SEGMEN.map(([nama, a, b]) => {
    const produk = perJam.filter((x) => x.jam >= a && x.jam <= b).reduce((s, x) => s + x.produk, 0);
    return { nama, dari: a, sampai: b, produk, porsi: (produk / totalProdukJam) * 100 };
  }).sort((x, y) => y.produk - x.produk);

  const batal = kartu?.batal || 0;
  const pesanan = kartu?.pesanan || 0;
  return {
    kartu: {
      pesanan, pesananSah: kartu?.pesanan_sah || 0, batal,
      gmv: Number(kartu?.gmv) || 0,
      netGmv: Number(kartu?.net_gmv) || 0,
      nilaiBatal: Number(kartu?.nilai_batal) || 0,
      produk: kartu?.produk || 0,
      rataPerPesanan: kartu?.pesanan_sah ? Number(kartu.net_gmv) / kartu.pesanan_sah : 0,
      produkPerPesanan: kartu?.pesanan_sah ? (kartu.produk || 0) / kartu.pesanan_sah : 0,
      tingkatBatal: pesanan ? (batal / pesanan) * 100 : 0,
      retur: retur?.jumlah || 0,
      nilaiRetur: Number(retur?.nilai) || 0,
    },
    harian: harian.map((r) => ({
      tanggal: r.tanggal, pesanan: r.pesanan, batal: r.batal,
      nilaiBatal: Number(r.nilai_batal) || 0,
      gmv: Number(r.gmv) || 0, penjualan: Number(r.penjualan) || 0, produk: r.produk,
      tingkatBatal: r.pesanan ? (r.batal / r.pesanan) * 100 : 0,
      rata: r.pesanan - r.batal > 0 ? Number(r.penjualan) / (r.pesanan - r.batal) : 0,
    })),
    perJam, segmen,
    alasan: alasan.map((r) => ({ ...r, nilai: Number(r.nilai) || 0,
      porsi: batal ? (r.pesanan / batal) * 100 : 0 })),
    pola: { hari: jumlahkan('hari'), minggu: jumlahkan('minggu'), sepertiga: jumlahkan('sepertiga') },
  };
}
