import { q } from './db';

/**
 * ── Scan & Kirim ──
 *
 * Memindahkan pesanan dari "Sedang dikemas" ke "Siap dijemput" dengan
 * menembak barcode nomor resi. Murni catatan internal: TIDAK memanggil
 * Shopee sama sekali, karena ship_order sudah dijalankan waktu Pack.
 * Jadi tidak ada satu pun aksi yang tak bisa dibatalkan di sini.
 *
 * Setiap scan dicatat di scan_log — yang berhasil maupun yang gagal.
 * Riwayat dan angka besar di layar dibaca dari tabel itu, bukan dari
 * memori peramban, supaya halaman boleh ditutup atau dimuat ulang
 * kapan saja tanpa kehilangan hitungan.
 */

const PRA_KIRIM = ['READY_TO_SHIP', 'RETRY_SHIP', 'PROCESSED'];

/**
 * Bentuk baku nomor resi: huruf besar, tanpa spasi. HARUS sama persis
 * dengan bentuk yang dipakai index idx_orders_resi_norm di schema.sql —
 * kalau berbeda sedikit saja, indexnya tidak terpakai dan tiap scan
 * menyapu seluruh tabel pesanan.
 */
export const normResi = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

const jamID = (d) => new Date(d).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit',
});

/** Catat hasil scan lalu kembalikan hasilnya apa adanya ke pemanggil. */
async function simpan(h) {
  const hasil = { ok: false, jenis: h.kode === 'duplikat' ? 'duplikat' : 'gagal', ...h };
  if (h.ok) hasil.jenis = 'sukses';
  try {
    // Pesanan TikTok tidak ada di tabel orders (order_id-nya kunci asing ke
    // sana), jadi untuk TikTok order_id & shop_id dikosongkan dan nama toko
    // disimpan langsung.
    const tt = hasil.platform === 'tiktok';
    const r = await q(
      `INSERT INTO scan_log (resi, order_id, shop_id, order_sn, carrier, ok, sebab, pesan, oleh, toko_nama)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, scanned_at`,
      [hasil.resi, tt ? null : (hasil.order_id || null), tt ? null : (hasil.shop_id || null),
       hasil.order_sn || null, hasil.carrier || null, !!hasil.ok, hasil.kode,
       String(hasil.pesan).slice(0, 500), hasil.oleh || null,
       tt ? `${hasil.shop_name || ''} (TikTok)` : null]);
    hasil.id = r[0]?.id;
    hasil.waktu = r[0]?.scanned_at;
  } catch {
    // Catatan gagal disimpan tidak boleh menggagalkan scan-nya sendiri.
    hasil.id = `sementara-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    hasil.waktu = new Date().toISOString();
  }
  delete hasil.oleh;
  return hasil;
}

/**
 * Satu tembakan barcode. Urutan pemeriksaannya disengaja: yang paling
 * berbahaya diperiksa paling awal, supaya paket pesanan batal tidak
 * pernah lolos hanya karena kebetulan tahapnya masih benar.
 */
/**
 * Cari pesanan dari barcode yang ditembak. Urutan:
 *   1. nomor resi Shopee
 *   2. nomor resi TikTok
 *   3. NOMOR PESANAN Shopee — label SPX Instant/Sameday tidak memuat nomor
 *      resi; barcode besarnya berisi nomor pesanan (terbukti dari label asli)
 *   4. nomor pesanan TikTok
 * Berhenti di langkah pertama yang menemukan sesuatu.
 */
async function cariPesanan(resi) {
  const SHOPEE = `
    SELECT 'shopee' AS platform, o.id, o.order_sn, o.shop_id::text AS shop_id, o.status, o.carrier,
           o.tracking_no, o.printed_at, o.packed_at, o.ship_arranged_at, o.recipient_name,
           s.shop_name, o.created_time
      FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id`;
  const TIKTOK = `
    SELECT 'tiktok' AS platform, NULL::bigint AS id, t.order_id AS order_sn, t.shop_id,
           t.status, t.shipping_provider AS carrier, t.tracking_number AS tracking_no,
           t.dicetak_at AS printed_at, t.packed_at, t.atur_kirim_at AS ship_arranged_at,
           NULL AS recipient_name, ts.shop_name, t.create_time AS created_time
      FROM tiktok_orders t LEFT JOIN tiktok_shops ts ON ts.shop_id = t.shop_id`;
  const langkah = [
    [`${SHOPEE} WHERE upper(replace(o.tracking_no, ' ', '')) = $1`, 'resi'],
    [`${TIKTOK} WHERE upper(replace(t.tracking_number, ' ', '')) = $1`, 'resi'],
    [`${SHOPEE} WHERE o.order_sn = $1`, 'pesanan'],
    [`${TIKTOK} WHERE t.order_id = $1`, 'pesanan'],
  ];
  for (const [sql, lewat] of langkah) {
    const rows = await q(`${sql} ORDER BY created_time DESC NULLS LAST LIMIT 2`, [resi]);
    if (rows.length) return { rows, lewat };
  }
  return { rows: [], lewat: null };
}

/** Pemeriksaan khusus TikTok — status TikTok berbeda kosakatanya. */
async function scanTiktok(resi, oleh, o) {
  const info = { platform: 'tiktok', order_sn: o.order_sn, shop_id: o.shop_id,
    shop_name: o.shop_name, carrier: o.carrier, penerima: null };
  if (o.status === 'CANCELLED') {
    return simpan({ resi, oleh, ...info, kode: 'batal',
      pesan: 'Pesanan TikTok ini SUDAH DIBATALKAN. Jangan dikirim — pisahkan paketnya sekarang.' });
  }
  if (o.packed_at) {
    return simpan({ resi, oleh, ...info, kode: 'duplikat',
      pesan: `Resi ini SUDAH discan ${jamID(o.packed_at)} dan sudah ada di Siap dijemput.` });
  }
  if (['IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'PARTIALLY_SHIPPING'].includes(o.status)) {
    return simpan({ resi, oleh, ...info, kode: 'sudah-jalan',
      pesan: 'Paket ini sudah dijemput kurir menurut TikTok, jadi tidak perlu discan lagi.' });
  }
  if (['UNPAID', 'ON_HOLD'].includes(o.status)) {
    return simpan({ resi, oleh, ...info, kode: 'unpaid',
      pesan: 'Pesanan TikTok ini belum bisa diproses (belum dibayar / masih ditahan TikTok).' });
  }
  if (o.status !== 'AWAITING_COLLECTION' && !o.ship_arranged_at) {
    return simpan({ resi, oleh, ...info, kode: 'belum-pack',
      pesan: 'Pesanan TikTok ini belum diatur kirim. Tekan Atur kirim TikTok dulu, baru discan.' });
  }
  const upd = await q(`
    UPDATE tiktok_orders SET packed_at = now(), dicetak_at = COALESCE(dicetak_at, now())
     WHERE order_id = $1 AND packed_at IS NULL RETURNING packed_at`, [o.order_sn]);
  if (!upd.length) {
    return simpan({ resi, oleh, ...info, kode: 'duplikat',
      pesan: 'Resi ini baru saja discan di perangkat lain, beberapa detik lalu.' });
  }
  return simpan({ resi, oleh, ...info, ok: true, kode: 'sukses', pesan: 'Dipindahkan ke Siap dijemput.' });
}

export async function scanResi(resiMentah, oleh = null) {
  const resi = normResi(resiMentah);
  if (!resi) return { ok: false, jenis: 'gagal', kode: 'kosong', resi: '', pesan: 'Resi kosong.' };

  const { rows } = await cariPesanan(resi);
  if (rows.length === 1 && rows[0].platform === 'tiktok') return scanTiktok(resi, oleh, rows[0]);

  if (!rows.length) {
    return simpan({ resi, oleh, kode: 'tidak-ada',
      pesan: 'Resi / nomor pesanan ini tidak ada di satu pun toko Shopee maupun TikTok. '
           + 'Kemungkinan pesanannya belum tersinkron, atau yang tertembak barcode lain di label.' });
  }
  if (rows.length > 1) {
    return simpan({ resi, oleh, kode: 'ganda',
      pesan: 'Resi ini terdaftar di lebih dari satu pesanan. Jangan dikirim dulu — periksa manual.' });
  }

  const o = rows[0];
  const info = {
    order_id: o.id, order_sn: o.order_sn, shop_id: o.shop_id,
    shop_name: o.shop_name, carrier: o.carrier, penerima: o.recipient_name,
  };

  if (o.status === 'CANCELLED' || o.status === 'TO_RETURN') {
    return simpan({ resi, oleh, ...info, kode: 'batal',
      pesan: 'Pesanan ini SUDAH DIBATALKAN. Jangan dikirim — pisahkan paketnya sekarang.' });
  }
  if (o.status === 'IN_CANCEL') {
    return simpan({ resi, oleh, ...info, kode: 'mintabatal',
      pesan: 'Pembeli sedang minta batal dan belum ditanggapi. Tahan dulu paketnya.' });
  }
  if (o.packed_at) {
    return simpan({ resi, oleh, ...info, kode: 'duplikat',
      pesan: `Resi ini SUDAH discan ${jamID(o.packed_at)} dan sudah ada di Siap dijemput.` });
  }
  if (['SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED'].includes(o.status)) {
    return simpan({ resi, oleh, ...info, kode: 'sudah-jalan',
      pesan: 'Paket ini sudah dijemput kurir menurut Shopee, jadi tidak perlu discan lagi.' });
  }
  if (o.status === 'UNPAID') {
    return simpan({ resi, oleh, ...info, kode: 'unpaid',
      pesan: 'Pesanan ini belum dibayar pembeli.' });
  }
  if (!PRA_KIRIM.includes(o.status)) {
    return simpan({ resi, oleh, ...info, kode: 'status',
      pesan: `Status Shopee-nya ${o.status || 'tidak diketahui'}, di luar alur pengiriman.` });
  }
  /**
   * Syaratnya kini HANYA ship_arranged_at (sudah di-Pack / diatur kirim di
   * Shopee). Dulu printed_at juga dihitung — tapi resi SPX Instant/Sameday
   * bisa dicetak SEBELUM Pack, dan barcode-nya (nomor pesanan) kini dikenali,
   * jadi tanpa syarat ini paket yang pengirimannya belum diatur bisa lolos
   * ke Siap dijemput dan tidak pernah dijemput kurir.
   */
  if (!o.ship_arranged_at) {
    return simpan({ resi, oleh, ...info, kode: 'belum-pack',
      pesan: 'Pesanan ini masih di tab Pesanan baru — belum di-Pack. Pack dulu, baru discan.' });
  }

  // Syarat packed_at IS NULL menjaga dua alat scan yang menembak resi
  // sama pada detik yang sama: hanya satu yang mendapat baris ini.
  const upd = await q(`
    UPDATE orders
       SET packed_at  = now(),
           printed_at = COALESCE(printed_at, now())
     WHERE id = $1 AND packed_at IS NULL
     RETURNING packed_at`, [o.id]);

  if (!upd.length) {
    return simpan({ resi, oleh, ...info, kode: 'duplikat',
      pesan: 'Resi ini baru saja discan di perangkat lain, beberapa detik lalu.' });
  }

  return simpan({ resi, oleh, ...info, ok: true, kode: 'sukses',
    pesan: 'Dipindahkan ke Siap dijemput.' });
}

/** Angka besar di layar: hasil scan hari ini menurut zona Jakarta. */
export async function ringkasScan() {
  const r = await q(`
    SELECT COUNT(*) FILTER (WHERE ok)::int      AS berhasil,
           COUNT(*) FILTER (WHERE NOT ok)::int  AS gagal
      FROM scan_log
     WHERE (scanned_at AT TIME ZONE 'Asia/Jakarta')::date
         = (now()      AT TIME ZONE 'Asia/Jakarta')::date`);
  return { berhasil: Number(r[0]?.berhasil || 0), gagal: Number(r[0]?.gagal || 0) };
}

/**
 * Riwayat dibatasi sengaja. Seribu baris di layar membuat halaman berat
 * dan justru memperlambat operator; yang lengkap tetap tersimpan di
 * tabel dan bisa dilihat lewat Antrean atau ekspor kalau perlu.
 */
export async function riwayatScan({ batas = 50, hanyaGagal = false } = {}) {
  return q(`
    SELECT l.id, l.resi, l.order_sn, l.carrier, l.ok, l.sebab, l.pesan, l.oleh, l.scanned_at,
           COALESCE(s.shop_name, l.toko_nama) AS shop_name
      FROM scan_log l
      LEFT JOIN shops s ON s.shop_id = l.shop_id
     WHERE (l.scanned_at AT TIME ZONE 'Asia/Jakarta')::date
         = (now()        AT TIME ZONE 'Asia/Jakarta')::date
       ${hanyaGagal ? 'AND l.ok = false' : ''}
     ORDER BY l.id DESC
     LIMIT ${Number(batas) || 50}`);
}
