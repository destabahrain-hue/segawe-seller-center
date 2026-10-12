import crypto from 'node:crypto';
import { getPool, q } from './db';

/**
 * ── Mutasi stok manual (pengganti sheet stok gudang) ──
 *
 * Satu kali simpan formulir = satu BATCH: satu surat jalan supplier, atau
 * satu rekap keluar TikTok hari itu. Semua barisnya masuk dalam satu
 * transaksi — kalau satu baris ditolak, tidak ada yang tersimpan setengah.
 *
 * Keluar Shopee TIDAK dicatat di sini. Itu dipotong otomatis saat pesanan
 * dikirim; mencatatnya manual juga berarti stok terpotong dua kali.
 */
export const JENIS = {
  supplier:    { arah: 'in',     label: 'Masuk dari supplier', pendek: 'Supplier' },
  retur:       { arah: 'in',     label: 'Retur masuk',          pendek: 'Retur' },
  lain_masuk:  { arah: 'in',     label: 'Masuk lain-lain',      pendek: 'Lain masuk' },
  tiktok:      { arah: 'out',    label: 'Keluar TikTok Shop',   pendek: 'TikTok' },
  terpakai:    { arah: 'out',    label: 'Terpakai (packing/operasional)', pendek: 'Terpakai' },
  offline:     { arah: 'out',    label: 'Keluar offline',       pendek: 'Offline' },
  lain_keluar: { arah: 'out',    label: 'Keluar lain-lain',     pendek: 'Lain keluar' },
  opname:      { arah: 'adjust', label: 'Koreksi (+/−)',        pendek: 'Koreksi' },
};

/**
 * Yang khusus akun master adalah MENGEDIT stok: koreksi (+/−) dan
 * membatalkan catatan yang sudah tersimpan. Mencatat barang masuk dan
 * keluar (TikTok, offline, lain-lain) boleh dilakukan tim.
 */
export const perluMaster = (jenis) => jenis === 'opname';
// Hanya untuk tampilan riwayat; tidak bisa dipilih di formulir.
export const LABEL_JENIS = { ...Object.fromEntries(Object.entries(JENIS).map(([k, v]) => [k, v.pendek])),
                             shopee: 'Shopee' };

const hariIniWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

/**
 * Waktu mutasi. Hari ini → jam sekarang. Tanggal lain → pukul 12:00 WIB,
 * supaya tetap jatuh di tanggal yang benar walau dibaca di zona mana pun.
 */
function waktuMutasi(tanggal) {
  if (!tanggal || tanggal === hariIniWib()) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw new Error('Tanggal tidak sah');
  const d = new Date(`${tanggal}T12:00:00+07:00`);
  if (d > new Date()) throw new Error('Tanggal tidak boleh di masa depan');
  return d;
}

/**
 * @param baris [{ master_sku_id, qty, harga }]
 * @returns { batchId, baris: jumlah baris stock_moves, minus: [{code, saldo}] }
 */
export async function catatMutasi({ jenis, tanggal, supplier = null, catatan = null, baris = [],
                                   oleh = null, bolehHarga = false, izinkanPaket = false }) {
  const J = JENIS[jenis];
  if (!J) throw new Error('Jenis mutasi tidak dikenal');
  const moved = waktuMutasi(tanggal);

  // Satukan SKU yang sama di satu formulir: dua baris "GCU 10" + "GCU 5"
  // disimpan sebagai 15, bukan dua mutasi yang membingungkan riwayat.
  const kumpul = new Map();
  for (const b of baris) {
    const id = Number(b.master_sku_id);
    const qty = Math.trunc(Number(b.qty));
    if (!id) continue;
    if (!Number.isFinite(qty) || qty === 0) throw new Error('Jumlah tiap baris wajib diisi dan bukan nol');
    if (J.arah !== 'adjust' && qty < 0) throw new Error('Jumlah tidak boleh minus — pakai jenis Koreksi untuk mengurangi');
    const lama = kumpul.get(id) || { qty: 0, harga: null };
    lama.qty += qty;
    const h = Number(b.harga);
    if (h > 0) lama.harga = h;
    kumpul.set(id, lama);
  }
  if (!kumpul.size) throw new Error('Belum ada barang yang diisi');
  if (jenis === 'supplier' && !String(supplier || '').trim()) throw new Error('Nama supplier wajib diisi');

  const ids = [...kumpul.keys()];
  const master = await q(
    `SELECT ms.id, ms.code, ms.kind,
            COALESCE(json_agg(json_build_object('child', c.child_id, 'qty', c.qty))
                     FILTER (WHERE c.child_id IS NOT NULL), '[]') AS komponen
       FROM master_sku ms
       LEFT JOIN master_sku_component c ON c.parent_id = ms.id
      WHERE ms.id = ANY($1::bigint[])
      GROUP BY ms.id`, [ids]);
  if (master.length !== ids.length) throw new Error('Ada Master SKU yang tidak ditemukan');

  /**
   * Paket bundling diuraikan ke komponennya — sama seperti potongan stok
   * pesanan Shopee. Stok fisik yang ada di rak adalah komponennya; paket
   * tidak punya stok sendiri.
   */
  const gerak = new Map();   // master_sku_id → { qty, harga, catatan }
  for (const m of master) {
    const { qty, harga } = kumpul.get(Number(m.id));
    if (m.kind === 'paket' && !izinkanPaket) {
      throw new Error(`${m.code} adalah paket bundling — catat barang satuannya`);
    }
    if (m.kind === 'paket') {
      const komp = m.komponen || [];
      if (!komp.length) throw new Error(`Paket ${m.code} belum punya komponen — atur dulu di Master SKU`);
      for (const k of komp) {
        const g = gerak.get(Number(k.child)) || { qty: 0, harga: null, dari: [] };
        g.qty += qty * Number(k.qty || 1);
        g.dari.push(m.code);
        gerak.set(Number(k.child), g);
      }
    } else {
      const g = gerak.get(Number(m.id)) || { qty: 0, harga: null, dari: [] };
      g.qty += qty;
      if (harga) g.harga = harga;
      gerak.set(Number(m.id), g);
    }
  }

  const batchId = crypto.randomUUID();
  const sup = String(supplier || '').trim() || null;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const [id, g] of gerak) {
      const note = [catatan, g.dari.length ? `dari paket ${[...new Set(g.dari)].join(', ')}` : null]
        .filter(Boolean).join(' · ') || null;
      await client.query(
        `INSERT INTO stock_moves (master_sku_id, direction, qty, unit_cost, ref_type, ref_id, note,
                                  moved_at, jenis, supplier, dicatat_oleh, batch_id)
         VALUES ($1,$2,$3,$4,'manual',$5,$6,$7,$8,$9,$10,$5)`,
        [id, J.arah, g.qty, bolehHarga && g.harga ? g.harga : null, batchId, note,
         moved, jenis, sup, oleh]);
      // Harga beli dari supplier sekaligus jadi HPP berlaku (seperti formulir lama).
      if (jenis === 'supplier' && bolehHarga && g.harga) {
        await client.query(
          `INSERT INTO master_sku_hpp (master_sku_id, hpp, effective_from, note)
           VALUES ($1,$2,($3::timestamptz AT TIME ZONE 'Asia/Jakarta')::date,'dari stok masuk')
           ON CONFLICT (master_sku_id, effective_from) DO UPDATE SET hpp = EXCLUDED.hpp`,
          [id, g.harga, moved]);
      }
      // Supplier pertama kali tercatat → jadi supplier langganan SKU itu.
      if (sup) {
        await client.query(`UPDATE master_sku SET supplier = $2 WHERE id = $1 AND supplier IS NULL`, [id, sup]);
      }
    }
    await client.query(
      `INSERT INTO activity_log (kind, message, ok) VALUES ('gudang', $1, true)`,
      [`${oleh || 'tidak diketahui'} mencatat ${JENIS[jenis].label.toLowerCase()} — ${gerak.size} SKU`
       + (sup ? `, supplier ${sup}` : '') + ` (batch ${batchId.slice(0, 8)})`]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Peringatan (bukan penolakan): stok yang jadi minus setelah keluar.
  // Tetap disimpan, karena barangnya memang sudah keluar — yang salah
  // biasanya catatan masuk yang belum diisi, dan itu harus terlihat.
  const minus = J.arah === 'in' ? [] : await q(
    `SELECT ms.code, SUM(CASE WHEN sm.direction = 'in' THEN sm.qty
                              WHEN sm.direction = 'out' THEN -sm.qty ELSE sm.qty END)::int AS saldo
       FROM stock_moves sm JOIN master_sku ms ON ms.id = sm.master_sku_id
      WHERE sm.master_sku_id = ANY($1::bigint[])
      GROUP BY ms.code HAVING SUM(CASE WHEN sm.direction = 'in' THEN sm.qty
                                       WHEN sm.direction = 'out' THEN -sm.qty ELSE sm.qty END) < 0`,
    [[...gerak.keys()]]);

  return { batchId, baris: gerak.size, minus };
}

/**
 * Batalkan satu batch manual (salah input). Mutasi Shopee tidak pernah
 * bisa dibatalkan dari sini. HPP yang ikut tercatat dari batch itu
 * TIDAK dihapus otomatis — riwayat HPP diperiksa terpisah di Master SKU.
 */
export async function batalkanBatch(batchId, oleh = null) {
  const r = await q(
    `DELETE FROM stock_moves WHERE batch_id = $1 AND ref_type = 'manual' AND jenis <> 'shopee'
     RETURNING master_sku_id, jenis`, [batchId]);
  // Membatalkan hasil opname membuka kembali opname-nya sebagai draf,
  // supaya hitungannya bisa dibetulkan lalu diterapkan ulang.
  if (r.length && String(batchId).startsWith('opname-')) {
    await q(`UPDATE opname SET status = 'draf', diterapkan_oleh = NULL, diterapkan_at = NULL
              WHERE id = $1 AND status = 'diterapkan'
                AND NOT EXISTS (SELECT 1 FROM opname WHERE status = 'draf')`,
      [Number(String(batchId).slice(7)) || 0]).catch(() => {});
  }
  if (r.length) {
    await q(`INSERT INTO activity_log (kind, message, ok) VALUES ('gudang', $1, true)`,
      [`${oleh || 'tidak diketahui'} membatalkan batch ${String(batchId).slice(0, 8)} (${r.length} baris ${r[0].jenis})`]);
  }
  return r.length;
}

/** Daftar supplier yang pernah dipakai, untuk isian otomatis. */
export async function daftarSupplier() {
  const r = await q(
    `SELECT s FROM (SELECT supplier AS s FROM master_sku WHERE supplier IS NOT NULL
                    UNION SELECT supplier FROM stock_moves WHERE supplier IS NOT NULL) x
      WHERE TRIM(s) <> '' ORDER BY 1`);
  return r.map((x) => x.s);
}

/** Batch manual terakhir, satu baris per batch, untuk riwayat & tombol batal. */
export async function batchTerakhir(limit = 30) {
  return q(
    `SELECT sm.batch_id, sm.jenis, MIN(sm.moved_at) AS moved_at, MIN(sm.supplier) AS supplier,
            MIN(sm.dicatat_oleh) AS oleh, MIN(sm.note) AS note,
            COUNT(*)::int AS sku, SUM(ABS(sm.qty))::int AS unit,
            string_agg(ms.code || ' ' || sm.qty, ', ' ORDER BY ms.code) AS isi
       FROM stock_moves sm JOIN master_sku ms ON ms.id = sm.master_sku_id
      WHERE sm.batch_id IS NOT NULL
      GROUP BY sm.batch_id, sm.jenis
      ORDER BY MIN(sm.moved_at) DESC
      LIMIT $1`, [limit]);
}

/**
 * Master SKU TUNGGAL untuk isian formulir: kode, saldo, dan thumbnail.
 *
 * Paket bundling sengaja tidak ikut — yang ada di rak adalah barang
 * satuannya. Keluar paket lewat Shopee sudah diuraikan otomatis ke
 * komponennya saat pesanan dikirim.
 *
 * Master SKU tidak punya foto sendiri, jadi fotonya dipinjam dari pesanan
 * TERBARU (90 hari) yang SKU tokonya tertaut ke Master SKU itu; kalau tidak
 * ada, dari katalog produk toko.
 */
export async function pilihanMaster() {
  return q(`
    WITH saldo AS (
      SELECT master_sku_id AS id,
             SUM(CASE WHEN direction = 'in' THEN qty WHEN direction = 'out' THEN -qty ELSE qty END)::int AS saldo
        FROM stock_moves GROUP BY 1
    ),
    foto_pesanan AS (
      SELECT DISTINCT ON (sm.master_sku_id) sm.master_sku_id AS id, oi.image_url
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN sku_mapping sm ON sm.shop_id = o.shop_id
                           AND sm.shop_sku IN (NULLIF(TRIM(oi.model_sku), ''), NULLIF(TRIM(oi.item_sku), ''))
       WHERE oi.image_url IS NOT NULL AND sm.master_sku_id IS NOT NULL
         AND o.created_time >= now() - interval '90 days'
       ORDER BY sm.master_sku_id, o.created_time DESC
    ),
    foto_katalog AS (
      SELECT DISTINCT ON (sm.master_sku_id) sm.master_sku_id AS id, p.image_url
        FROM products p
        LEFT JOIN product_models pm ON pm.product_id = p.id
        JOIN sku_mapping sm ON sm.shop_id = p.shop_id
                           AND sm.shop_sku IN (NULLIF(TRIM(pm.model_sku), ''), NULLIF(TRIM(p.item_sku), ''))
       WHERE p.image_url IS NOT NULL AND sm.master_sku_id IS NOT NULL
       ORDER BY sm.master_sku_id, p.synced_at DESC NULLS LAST
    )
    SELECT ms.id, ms.code, ms.name, COALESCE(s.saldo, 0) AS saldo,
           COALESCE(fp.image_url, fk.image_url) AS gambar
      FROM master_sku ms
      LEFT JOIN saldo s ON s.id = ms.id
      LEFT JOIN foto_pesanan fp ON fp.id = ms.id
      LEFT JOIN foto_katalog fk ON fk.id = ms.id
     WHERE ms.kind <> 'paket'
     ORDER BY ms.code`);
}
