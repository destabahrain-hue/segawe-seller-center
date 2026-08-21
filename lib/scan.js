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
    const r = await q(
      `INSERT INTO scan_log (resi, order_id, shop_id, order_sn, carrier, ok, sebab, pesan, oleh)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, scanned_at`,
      [hasil.resi, hasil.order_id || null, hasil.shop_id || null, hasil.order_sn || null,
       hasil.carrier || null, !!hasil.ok, hasil.kode, String(hasil.pesan).slice(0, 500),
       hasil.oleh || null]);
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
export async function scanResi(resiMentah, oleh = null) {
  const resi = normResi(resiMentah);
  if (!resi) return { ok: false, jenis: 'gagal', kode: 'kosong', resi: '', pesan: 'Resi kosong.' };

  const rows = await q(`
    SELECT o.id, o.order_sn, o.shop_id, o.status, o.carrier, o.tracking_no,
           o.printed_at, o.packed_at, o.ship_arranged_at, o.recipient_name,
           s.shop_name
      FROM orders o
      LEFT JOIN shops s ON s.shop_id = o.shop_id
     WHERE upper(replace(o.tracking_no, ' ', '')) = $1
     ORDER BY o.created_time DESC NULLS LAST
     LIMIT 2`, [resi]);

  if (!rows.length) {
    return simpan({ resi, oleh, kode: 'tidak-ada',
      pesan: 'Resi ini tidak ada di satu pun toko. Kemungkinan pesanannya belum tersinkron, '
           + 'atau yang tertembak barcode lain di label.' });
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
  if (!o.ship_arranged_at && !o.printed_at) {
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
           s.shop_name
      FROM scan_log l
      LEFT JOIN shops s ON s.shop_id = l.shop_id
     WHERE (l.scanned_at AT TIME ZONE 'Asia/Jakarta')::date
         = (now()        AT TIME ZONE 'Asia/Jakarta')::date
       ${hanyaGagal ? 'AND l.ok = false' : ''}
     ORDER BY l.id DESC
     LIMIT ${Number(batas) || 50}`);
}
