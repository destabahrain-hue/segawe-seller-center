import { getPool, q, one } from './db';


/**
 * ── Stock opname ──
 *
 * Alurnya meniru kolom "Stock Opname Adjustment" di sheet lama, tapi
 * selisihnya dihitung sistem:
 *   1. siapa pun di Gudang membuka opname (draf) dan mengisi stok fisik;
 *   2. saat satu barang dicatat, stok sistemnya DIPOTRET;
 *   3. akun master menerapkan → selisih (fisik − potret) jadi koreksi.
 *
 * Kenapa dipotret, bukan dibandingkan dengan stok saat diterapkan: kalau
 * barang dihitung pagi, lalu siangnya 5 unit keluar lewat Shopee, lalu
 * sorenya opname diterapkan — membandingkan dengan stok sore akan
 * "mengembalikan" 5 unit yang sudah benar-benar keluar.
 */

const SALDO = `SELECT master_sku_id AS id,
                      SUM(CASE WHEN direction = 'in' THEN qty WHEN direction = 'out' THEN -qty ELSE qty END)::int AS saldo
                 FROM stock_moves GROUP BY 1`;

export async function opnameDraf() {
  return one(`SELECT * FROM opname WHERE status = 'draf' ORDER BY id DESC LIMIT 1`);
}

export async function mulaiOpname({ oleh, catatan }) {
  const ada = await opnameDraf();
  if (ada) return ada;
  const baru = await one(`INSERT INTO opname (dibuat_oleh, catatan) VALUES ($1, $2)
                          ON CONFLICT DO NOTHING RETURNING *`, [oleh, catatan || null]);
  return baru || opnameDraf();   // kalau orang lain membuka di saat yang sama
}

/** Baris opname + stok sistem sekarang, untuk semua Master SKU tunggal. */
export async function isiOpname(opnameId) {
  return q(`
    WITH saldo AS (${SALDO})
    SELECT ms.id, ms.code, COALESCE(s.saldo, 0) AS kini,
           b.stok_sistem, b.stok_fisik, b.dicatat_oleh, b.dicatat_at
      FROM master_sku ms
      LEFT JOIN saldo s ON s.id = ms.id
      LEFT JOIN opname_baris b ON b.master_sku_id = ms.id AND b.opname_id = $1
     WHERE ms.kind <> 'paket'
     ORDER BY ms.code`, [opnameId]);
}

/**
 * Simpan hitungan. stok_fisik kosong/null = batal dihitung (barisnya dihapus).
 * Mengubah hitungan yang sudah ada memotret ulang stok sistem, karena
 * hitungannya pun baru.
 */
export async function simpanHitungan(opnameId, baris, oleh) {
  const op = await one(`SELECT status FROM opname WHERE id = $1`, [opnameId]);
  if (!op) throw new Error('Opname tidak ditemukan');
  if (op.status !== 'draf') throw new Error('Opname ini sudah ditutup');
  const client = await getPool().connect();
  let n = 0;
  try {
    await client.query('BEGIN');
    for (const b of baris) {
      const id = Number(b.master_sku_id);
      if (!id) continue;
      if (b.stok_fisik === '' || b.stok_fisik === null || b.stok_fisik === undefined) {
        await client.query(`DELETE FROM opname_baris WHERE opname_id = $1 AND master_sku_id = $2`, [opnameId, id]);
        n++; continue;
      }
      const fisik = Math.trunc(Number(b.stok_fisik));
      if (!Number.isFinite(fisik) || fisik < 0) throw new Error('Stok fisik harus angka 0 atau lebih');
      const { rows: [ms] } = await client.query(`SELECT kind FROM master_sku WHERE id = $1`, [id]);
      if (!ms) throw new Error('Master SKU tidak ditemukan');
      if (ms.kind === 'paket') throw new Error('Paket bundling tidak dihitung — hitung barang satuannya');
      const { rows: [s] } = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty WHEN direction = 'out' THEN -qty ELSE qty END),0)::int AS saldo
           FROM stock_moves WHERE master_sku_id = $1`, [id]);
      await client.query(
        `INSERT INTO opname_baris (opname_id, master_sku_id, stok_sistem, stok_fisik, dicatat_oleh, dicatat_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (opname_id, master_sku_id) DO UPDATE SET
           stok_sistem = EXCLUDED.stok_sistem, stok_fisik = EXCLUDED.stok_fisik,
           dicatat_oleh = EXCLUDED.dicatat_oleh, dicatat_at = now()
         WHERE opname_baris.stok_fisik IS DISTINCT FROM EXCLUDED.stok_fisik`,
        [opnameId, id, s.saldo, fisik, oleh]);
      n++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  return n;
}

/** Hanya akun master. Selisih jadi mutasi koreksi, satu batch per opname. */
export async function terapkanOpname(opnameId, oleh) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [op] } = await client.query(`SELECT * FROM opname WHERE id = $1 FOR UPDATE`, [opnameId]);
    if (!op) throw new Error('Opname tidak ditemukan');
    if (op.status !== 'draf') throw new Error('Opname ini sudah ditutup');
    const { rows } = await client.query(
      `SELECT master_sku_id, stok_fisik - stok_sistem AS selisih, dicatat_oleh, dicatat_at
         FROM opname_baris WHERE opname_id = $1 AND stok_fisik <> stok_sistem`, [opnameId]);
    const batch = `opname-${opnameId}`;
    for (const r of rows) {
      await client.query(
        `INSERT INTO stock_moves (master_sku_id, direction, qty, ref_type, ref_id, note, moved_at,
                                  jenis, dicatat_oleh, batch_id)
         VALUES ($1,'adjust',$2,'manual',$3,$4,$5,'opname',$6,$3)`,
        [r.master_sku_id, r.selisih, batch,
         `Stock opname #${opnameId} (dihitung ${r.dicatat_oleh || '—'})`, r.dicatat_at, oleh]);
    }
    await client.query(`UPDATE opname SET status = 'diterapkan', diterapkan_oleh = $2, diterapkan_at = now()
                         WHERE id = $1`, [opnameId, oleh]);
    await client.query(`INSERT INTO activity_log (kind, message, ok) VALUES ('gudang', $1, true)`,
      [`${oleh} menerapkan stock opname #${opnameId} — ${rows.length} SKU berselisih`]);
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

export async function batalkanOpname(opnameId, oleh) {
  const r = await q(`UPDATE opname SET status = 'dibatalkan', diterapkan_oleh = $2, diterapkan_at = now()
                      WHERE id = $1 AND status = 'draf' RETURNING id`, [opnameId, oleh]);
  return r.length;
}

export async function riwayatOpname(limit = 10) {
  return q(`SELECT o.*, (SELECT COUNT(*) FROM opname_baris b WHERE b.opname_id = o.id)::int AS dihitung,
                   (SELECT COUNT(*) FROM opname_baris b WHERE b.opname_id = o.id AND b.stok_fisik <> b.stok_sistem)::int AS selisih,
                   (SELECT COALESCE(SUM(b.stok_fisik - b.stok_sistem),0) FROM opname_baris b WHERE b.opname_id = o.id)::int AS net
              FROM opname o ORDER BY o.id DESC LIMIT $1`, [limit]);
}

/**
 * Master SKU baru dari lembar opname — untuk barang yang tidak pernah
 * tercatat karena tidak dijual di marketplace (kardus, lakban, bubble wrap).
 * Selalu tipe tunggal: paket dibuat dari halaman Master SKU.
 */
export async function tambahSku({ code, name, reorder_at }) {
  const kode = String(code || '').trim().toUpperCase();
  const nama = String(name || '').trim();
  if (!kode || !nama) throw new Error('Kode dan nama wajib diisi');
  const ada = await one(`SELECT id, name FROM master_sku WHERE UPPER(code) = $1`, [kode]);
  if (ada) throw new Error(`Kode ${kode} sudah dipakai oleh "${ada.name}"`);
  return one(`INSERT INTO master_sku (code, name, kind, reorder_at) VALUES ($1,$2,'tunggal',$3) RETURNING *`,
             [kode, nama, Math.max(Number(reorder_at) || 0, 0)]);
}
