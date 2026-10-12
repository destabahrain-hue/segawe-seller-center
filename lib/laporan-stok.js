import { q } from './db';

/**
 * ── Laporan stok bulanan ──
 *
 * Bentuknya meniru sheet lama: saldo awal (sisa bulan lalu), masuk, keluar,
 * koreksi, saldo akhir — dipecah per asal mutasi, plus kisi per tanggal
 * 1–31 untuk masuk dan keluar. Hanya barang satuan; paket tidak punya stok
 * sendiri (keluar paket sudah diuraikan ke komponennya).
 *
 * Semua tanggal memakai kalender Jakarta.
 */
export const KOLOM_MASUK  = [['supplier', 'Supplier'], ['retur', 'Retur'], ['lain_masuk', 'Lain-lain']];
export const KOLOM_KELUAR = [['shopee', 'Shopee'], ['tiktok', 'TikTok'], ['offline', 'Offline'],
                             ['terpakai', 'Terpakai'], ['lain_keluar', 'Lain-lain']];

export function rentangBulan(bulan) {
  const m = /^(\d{4})-(\d{2})$/.exec(bulan || '');
  if (!m) throw new Error('Format bulan YYYY-MM');
  const y = Number(m[1]), b = Number(m[2]);
  const akhirY = b === 12 ? y + 1 : y, akhirB = b === 12 ? 1 : b + 1;
  const pad = (x) => String(x).padStart(2, '0');
  const hari = new Date(Date.UTC(y, b, 0)).getUTCDate();
  return { awal: `${y}-${pad(b)}-01`, akhir: `${akhirY}-${pad(akhirB)}-01`, hari };
}

export async function laporanBulanan(bulan, { denganNilai = false } = {}) {
  const r = rentangBulan(bulan);
  const TGL = `(sm.moved_at AT TIME ZONE 'Asia/Jakarta')::date`;
  const [sku, harian] = await Promise.all([
    q(`
      SELECT ms.id, ms.code, ms.supplier,
        COALESCE(SUM(CASE WHEN ${TGL} < $1::date THEN
          CASE WHEN sm.direction = 'in' THEN sm.qty WHEN sm.direction = 'out' THEN -sm.qty ELSE sm.qty END END), 0)::int AS awal,
        ${KOLOM_MASUK.map(([k]) => `COALESCE(SUM(sm.qty) FILTER (WHERE sm.direction = 'in' AND sm.jenis = '${k}'
            AND ${TGL} >= $1::date AND ${TGL} < $2::date), 0)::int AS m_${k}`).join(',\n        ')},
        ${KOLOM_KELUAR.map(([k]) => `COALESCE(SUM(sm.qty) FILTER (WHERE sm.direction = 'out' AND sm.jenis = '${k}'
            AND ${TGL} >= $1::date AND ${TGL} < $2::date), 0)::int AS k_${k}`).join(',\n        ')},
        -- Mutasi lama yang belum berjenis tetap ikut, supaya saldo akhir selalu cocok.
        COALESCE(SUM(sm.qty) FILTER (WHERE sm.direction = 'in' AND COALESCE(sm.jenis,'') NOT IN
            (${KOLOM_MASUK.map(([k]) => `'${k}'`).join(',')}) AND ${TGL} >= $1::date AND ${TGL} < $2::date), 0)::int AS m_lain2,
        COALESCE(SUM(sm.qty) FILTER (WHERE sm.direction = 'out' AND COALESCE(sm.jenis,'') NOT IN
            (${KOLOM_KELUAR.map(([k]) => `'${k}'`).join(',')}) AND ${TGL} >= $1::date AND ${TGL} < $2::date), 0)::int AS k_lain2,
        COALESCE(SUM(sm.qty) FILTER (WHERE sm.direction = 'adjust'
            AND ${TGL} >= $1::date AND ${TGL} < $2::date), 0)::int AS koreksi
        ${denganNilai ? `, COALESCE(
            (SELECT h.hpp FROM master_sku_hpp h WHERE h.master_sku_id = ms.id
                AND h.effective_from < $2::date ORDER BY h.effective_from DESC LIMIT 1),
            (SELECT h.hpp FROM master_sku_hpp h WHERE h.master_sku_id = ms.id
              ORDER BY h.effective_from ASC LIMIT 1), 0)::float AS hpp` : ''}
      FROM master_sku ms
      LEFT JOIN stock_moves sm ON sm.master_sku_id = ms.id AND ${TGL} < $2::date
      WHERE ms.kind <> 'paket'
      GROUP BY ms.id
      ORDER BY ms.code`, [r.awal, r.akhir]),
    q(`
      SELECT sm.master_sku_id AS id, EXTRACT(DAY FROM ${TGL})::int AS hari,
             SUM(sm.qty) FILTER (WHERE sm.direction = 'in')::int  AS masuk,
             SUM(sm.qty) FILTER (WHERE sm.direction = 'out')::int AS keluar
        FROM stock_moves sm
       WHERE ${TGL} >= $1::date AND ${TGL} < $2::date
       GROUP BY 1, 2`, [r.awal, r.akhir]),
  ]);

  const kisi = new Map();
  for (const h of harian) {
    const k = kisi.get(Number(h.id)) || { masuk: Array(r.hari).fill(0), keluar: Array(r.hari).fill(0) };
    k.masuk[h.hari - 1] = h.masuk || 0;
    k.keluar[h.hari - 1] = h.keluar || 0;
    kisi.set(Number(h.id), k);
  }

  const baris = sku.map((s) => {
    const masuk = KOLOM_MASUK.reduce((a, [k]) => a + s[`m_${k}`], 0) + s.m_lain2;
    const keluar = KOLOM_KELUAR.reduce((a, [k]) => a + s[`k_${k}`], 0) + s.k_lain2;
    const akhir = s.awal + masuk - keluar + s.koreksi;
    const g = kisi.get(Number(s.id)) || { masuk: Array(r.hari).fill(0), keluar: Array(r.hari).fill(0) };
    return {
      id: Number(s.id), code: s.code, supplier: s.supplier, awal: s.awal,
      masukPer: Object.fromEntries(KOLOM_MASUK.map(([k]) => [k, s[`m_${k}`] + (k === 'lain_masuk' ? s.m_lain2 : 0)])),
      keluarPer: Object.fromEntries(KOLOM_KELUAR.map(([k]) => [k, s[`k_${k}`] + (k === 'lain_keluar' ? s.k_lain2 : 0)])),
      masuk, keluar, koreksi: s.koreksi, akhir,
      hpp: denganNilai ? Number(s.hpp) || 0 : undefined,
      nilai: denganNilai ? akhir * (Number(s.hpp) || 0) : undefined,
      masukHarian: g.masuk, keluarHarian: g.keluar,
    };
  });

  const total = baris.reduce((a, b) => ({
    awal: a.awal + b.awal, masuk: a.masuk + b.masuk, keluar: a.keluar + b.keluar,
    koreksi: a.koreksi + b.koreksi, akhir: a.akhir + b.akhir, nilai: a.nilai + (b.nilai || 0),
  }), { awal: 0, masuk: 0, keluar: 0, koreksi: 0, akhir: 0, nilai: 0 });

  return { ...r, bulan, baris, total };
}
