import { q } from './db';
import { rentang } from './rentang';

/**
 * Status di sini menggabungkan dua hal:
 *  - status resmi Shopee (UNPAID, READY_TO_SHIP, SHIPPED, …)
 *  - alur kerja gudang kita sendiri (resi dicetak, selesai dikemas)
 *
 * Shopee tidak membedakan "sedang dikemas" dan "siap dijemput" —
 * itu keadaan internal, sama seperti Printed Time / Packed Time di
 * BigSeller. Karena itu dua kolom waktu disimpan sendiri.
 */
const PRA_KIRIM = `o.status IN ('READY_TO_SHIP','RETRY_SHIP','PROCESSED')`;

export const STATUS = [
  { key: 'baru',    label: 'Pesanan baru',    grup: 'Sedang diproses',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NULL AND o.pack_gagal_at IS NULL
           AND o.disisihkan_at IS NULL`,
    jelas: 'Belum di-Pack — pengirimannya belum diatur ke Shopee' },

  // Dua tab di bawah ini memuat pesanan yang PERNAH dicoba di-Pack dan
  // ditolak. Syaratnya sengaja tetap menuntut ship_arranged_at kosong:
  // begitu Pack-nya berhasil, pesanannya keluar sendiri dari sini tanpa
  // perlu dibersihkan, dan pesanan yang keburu dibatalkan pindah ke tab
  // Batal karena syarat status di atas tidak lagi terpenuhi.
  /**
   * Pesanan yang sengaja ditahan — biasanya stoknya kosong. Dikeluarkan
   * dari semua tab tahap kerja supaya tidak ikut terproses, tapi TIDAK
   * dibatalkan: batas kirimnya tetap berjalan dan itu tetap kelihatan
   * di sini.
   */
  { key: 'sisih', label: 'Disisihkan', grup: 'Sedang diproses',
    cond: `${PRA_KIRIM} AND o.disisihkan_at IS NOT NULL`,
    jelas: 'Ditahan sendiri — tidak ikut diproses sampai dikembalikan' },
  { key: 'gagalpack', label: 'Proses gagal',   grup: 'Sedang diproses',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NULL AND o.disisihkan_at IS NULL
           AND o.pack_gagal_at IS NOT NULL AND o.pack_gagal_jenis = 'gagal'`,
    jelas: 'Ditolak Shopee saat Pack — perlu ditindak sebelum dicoba lagi' },
  { key: 'verifikasi', label: 'Menunggu proses marketplace', grup: 'Sedang diproses',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NULL AND o.disisihkan_at IS NULL
           AND o.pack_gagal_at IS NOT NULL AND o.pack_gagal_jenis = 'marketplace'`,
    jelas: 'Shopee belum siap memproses pesanan ini — coba Pack lagi nanti' },
  // Syaratnya kini HANYA ship_arranged_at. Dulu printed_at saja sudah
  // memindahkan pesanan ke sini, tapi resi instan boleh dicetak sebelum
  // Pack — dan pesanan yang belum diatur pengirimannya tidak boleh masuk
  // tab yang jadi sumber Scan & Kirim, karena resinya memang belum ada.
  { key: 'proses',  label: 'Sedang dikemas',  grup: 'Sedang diproses',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NOT NULL AND o.packed_at IS NULL
           AND o.disisihkan_at IS NULL`,
    jelas: 'Sudah di-Pack, resi terbit, sedang dikemas' },
  { key: 'pickup',  label: 'Siap dijemput',   grup: 'Sedang diproses',
    cond: `${PRA_KIRIM} AND o.packed_at IS NOT NULL`,
    jelas: 'Selesai dikemas, menunggu kurir' },
  { key: 'dikirim', label: 'Dikirim',         grup: 'Sedang diproses',
    cond: `o.status IN ('SHIPPED','TO_CONFIRM_RECEIVE')`,
    jelas: 'Dalam perjalanan' },
  { key: 'selesai', label: 'Selesai',         grup: 'Lainnya',
    cond: `o.status = 'COMPLETED'`,
    jelas: 'Selesai dan dana cair' },
  { key: 'mintabatal', label: 'Minta batal',  grup: 'Lainnya',
    cond: `o.status = 'IN_CANCEL'`,
    jelas: 'Pembeli minta batal — menunggu keputusanmu' },
  { key: 'batal',   label: 'Batal',           grup: 'Lainnya',
    cond: `o.status IN ('CANCELLED','TO_RETURN')`,
    jelas: 'Sudah dibatalkan atau diretur' },
  { key: 'unpaid',  label: 'Belum dibayar',   grup: 'Lainnya',
    cond: `o.status = 'UNPAID'`,
    jelas: 'Menunggu pembayaran pembeli' },
  { key: 'semua',   label: 'Semua pesanan',   grup: 'Lainnya',
    cond: `TRUE`,
    jelas: 'Tanpa penyaringan status' },
];

export const cariStatus = (k) => STATUS.find((s) => s.key === k) || STATUS[0];

/**
 * Status boleh dipilih LEBIH DARI SATU.
 *
 * Kebutuhan nyatanya: "barang yang keluar kemarin" = pesanan yang waktu
 * pengirimannya kemarin, dengan status Dikirim ATAU Selesai — karena
 * sebagian sudah keburu selesai saat laporannya dibuat. Dengan satu tab
 * saja, itu harus ditarik dua kali dan digabung manual; dengan "Semua",
 * pesanan batal yang telanjur terkirim ikut terbawa.
 *
 * Kunci yang tidak dikenal dibuang, bukan diselipkan ke SQL.
 */
export function kunciStatus(s) {
  const daftar = (Array.isArray(s) ? s : String(s || '').split(','))
    .map((x) => String(x).trim()).filter(Boolean);
  const sah = daftar.filter((k) => STATUS.some((x) => x.key === k));
  if (sah.includes('semua') || !sah.length) return ['semua'];
  return [...new Set(sah)];
}

export const kondisiStatus = (keys) => {
  const k = kunciStatus(keys);
  if (k.length === 1) return cariStatus(k[0]).cond;
  return '(' + k.map((x) => `(${cariStatus(x).cond})`).join(' OR ') + ')';
};

/**
 * Satu pesanan punya banyak stempel waktu, dan pertanyaannya berbeda-beda:
 * "berapa yang MASUK kemarin" memakai waktu pesanan dibuat, "berapa yang
 * DIKIRIM kemarin" memakai waktu pengiriman. Karena itu penyaringnya bisa
 * dipindah kolom, bukan dipaku ke created_time.
 *
 * Daftar ini juga berfungsi sebagai daftar putih: nama kolom TIDAK PERNAH
 * diambil dari alamat halaman, hanya dicocokkan ke sini. Kalau tidak,
 * parameter di URL bisa disusupkan langsung ke dalam SQL.
 */
export const BASIS_WAKTU = [
  ['dibuat', 'Waktu pesanan dibuat', 'o.created_time'],
  ['bayar',  'Waktu pembayaran',     'o.paid_at'],
  ['cetak',  'Waktu resi dicetak',   'o.printed_at'],
  ['kirim',  'Waktu pengiriman',     'o.ship_time'],
  ['batal',  'Waktu dibatalkan',     'o.cancelled_at'],
];
export const cariBasis = (k) => BASIS_WAKTU.find((b) => b[0] === k) || BASIS_WAKTU[0];

/**
 * Menerjemahkan parameter alamat halaman jadi rentang siap pakai.
 * Bawaannya SENGAJA tanpa penyaring waktu: halaman Pesanan adalah layar
 * kerja harian, dan diam-diam menyembunyikan pesanan lama karena bawaan
 * "hari ini" jauh lebih berbahaya daripada daftar yang kepanjangan.
 */
export function waktuDari({ w = null, r = null, dari = null, sampai = null } = {}) {
  if (!r || r === 'semua') return null;
  const x = rentang(r, dari, sampai);
  return { basis: cariBasis(w)[0], dari: x.dari, sampai: x.sampai, label: x.label };
}

function saring({ status = 'baru', shopId = null, kadaluarsa = null, cari = null, kurir = null,
                 waktu = null, cetak = null }) {
  const w = [kondisiStatus(status)];
  const p = [];

  // Sudah/belum dicetak. Dasarnya print_count, yang kini hanya naik setelah
  // operator memastikan kertasnya keluar — jadi "belum dicetak" benar-benar
  // berarti labelnya belum ada di meja, bukan sekadar PDF-nya belum dibuka.
  if (cetak === 'belum') w.push('COALESCE(o.print_count,0) = 0');
  if (cetak === 'sudah') w.push('COALESCE(o.print_count,0) > 0');

  // Pesanan yang kolom waktunya masih kosong memang sengaja tidak ikut:
  // menyaring "waktu pembayaran" tidak boleh memunculkan pesanan yang
  // belum dibayar sama sekali.
  if (waktu?.dari && waktu?.sampai) {
    const kol = cariBasis(waktu.basis)[2];
    p.push(waktu.dari); w.push(`${kol} >= $${p.length}`);
    p.push(waktu.sampai); w.push(`${kol} < $${p.length}`);
  }
  if (shopId) { p.push(shopId); w.push(`o.shop_id = $${p.length}`); }
  if (kadaluarsa === 'lewat')  w.push(`o.ship_by_date IS NOT NULL AND o.ship_by_date < now()`);
  if (kadaluarsa === 'segera') w.push(`o.ship_by_date IS NOT NULL AND o.ship_by_date >= now() AND o.ship_by_date < now() + interval '24 hours'`);
  if (kurir === '(kosong)') w.push(`NULLIF(TRIM(COALESCE(o.carrier,'')),'') IS NULL`);
  else if (kurir) { p.push(kurir); w.push(`o.carrier = $${p.length}`); }
  if (cari) {
    p.push(`%${String(cari).trim()}%`);
    const n = p.length;
    // Termasuk SKU dan nama barang. Dipakai EXISTS, bukan JOIN, supaya satu
    // pesanan tidak muncul berkali-kali hanya karena punya banyak barang.
    w.push(`(o.order_sn ILIKE $${n} OR o.tracking_no ILIKE $${n}
             OR o.recipient_name ILIKE $${n} OR o.package_number ILIKE $${n}
             OR EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id
                        AND (oi2.item_sku ILIKE $${n} OR oi2.model_sku ILIKE $${n}
                             OR oi2.item_name ILIKE $${n})))`);
  }
  return { where: w.join(' AND '), params: p };
}

/** Jumlah pesanan per status — untuk angka di menu. */
export async function hitungStatus({ shopId = null, waktu = null } = {}) {
  const bagian = STATUS.filter((s) => s.key !== 'semua')
    .map((s) => `SUM(CASE WHEN ${s.cond} THEN 1 ELSE 0 END)::int AS ${s.key}`).join(',\n           ');

  // Angka di chip harus memakai penyaring waktu yang sama dengan daftarnya.
  // Kalau tidak, chip bilang 400 sementara daftarnya berisi 12.
  const p = [];
  const w = [];
  if (shopId) { p.push(shopId); w.push(`o.shop_id = $${p.length}`); }
  if (waktu?.dari && waktu?.sampai) {
    const kol = cariBasis(waktu.basis)[2];
    p.push(waktu.dari); w.push(`${kol} >= $${p.length}`);
    p.push(waktu.sampai); w.push(`${kol} < $${p.length}`);
  }
  const rows = await q(`
    SELECT ${bagian},
           COUNT(*)::int AS semua,
           SUM(CASE WHEN o.ship_by_date IS NOT NULL AND o.ship_by_date < now()
                     AND ${PRA_KIRIM} THEN 1 ELSE 0 END)::int AS lewat,
           SUM(CASE WHEN o.ship_by_date IS NOT NULL AND o.ship_by_date >= now()
                     AND o.ship_by_date < now() + interval '24 hours'
                     AND ${PRA_KIRIM} THEN 1 ELSE 0 END)::int AS segera
    FROM orders o
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, p);
  return rows[0] || {};
}

/**
 * Daftar kurir beserta jumlah pesanannya, mengikuti status dan toko yang
 * sedang dipilih — supaya angkanya cocok dengan yang benar-benar terlihat.
 */
export async function hitungKurir(opsi = {}) {
  const { where, params } = saring({ ...opsi, kurir: null });

  /**
   * Kurir yang jumlahnya NOL tetap ditampilkan.
   *
   * Dulu daftarnya hanya berisi kurir yang muncul di hasil saring, jadi
   * kurir tanpa pesanan lenyap dari layar. Itu terbaca sebagai "aplikasi
   * ini tidak mendukung SPX Instant" padahal maksudnya "tidak ada pesanan
   * SPX Instant yang cocok dengan saringan sekarang" — dua hal yang sangat
   * berbeda, dan yang pertama membuat orang berhenti mencari.
   *
   * Daftar kurirnya diambil dari SELURUH pesanan toko (90 hari terakhir
   * supaya kurir yang sudah tidak dipakai lagi tidak menumpuk), lalu
   * jumlahnya dihitung menurut saringan yang sedang aktif.
   */
  return q(`
    WITH semua AS (
      SELECT DISTINCT COALESCE(NULLIF(TRIM(carrier),''), '(kosong)') AS kurir
        FROM orders
       WHERE created_time > now() - interval '90 days'
    ), terpakai AS (
      SELECT COALESCE(NULLIF(TRIM(o.carrier),''), '(kosong)') AS kurir,
             COUNT(*)::int AS jumlah
        FROM orders o
       WHERE ${where}
       GROUP BY 1
    )
    SELECT s.kurir, COALESCE(t.jumlah, 0) AS jumlah
      FROM semua s
      LEFT JOIN terpakai t ON t.kurir = s.kurir
     ORDER BY COALESCE(t.jumlah, 0) DESC, s.kurir`, params);
}

/** Jumlah seluruh pesanan yang cocok — untuk penomoran halaman. */
export async function hitungBaris(opsi = {}) {
  const { where, params } = saring(opsi);
  const r = await q(`SELECT COUNT(*)::int AS n FROM orders o WHERE ${where}`, params);
  return Number(r[0]?.n || 0);
}

export const PER_HALAMAN = [20, 50, 100, 200, 500];

/**
 * Pilihan pengurutan.
 *
 * Nama kolom TIDAK PERNAH diambil dari alamat halaman — hanya dicocokkan
 * ke daftar ini, supaya parameter URL tidak bisa disusupkan ke SQL.
 *
 * Yang berbasis SKU memakai ringkasan barang per pesanan: `sku_utama`
 * (SKU terkecil secara abjad) dan `sku_beda` (berapa SKU berbeda di
 * dalamnya). Aturannya sesuai permintaan: pesanan ber-SKU tunggal
 * diurutkan berdasarkan SKU-nya, dan pesanan ber-SKU banyak ditaruh
 * SETELAH urutan itu habis — supaya sortir pagi bisa mengambil satu tumpuk
 * SKU sekaligus, dan yang campur dikerjakan belakangan.
 */
export const URUT = [
  ['dibuat',   'Waktu pesanan',    'o.created_time'],
  ['bayar',    'Waktu pembayaran', 'o.paid_at'],
  ['cetak',    'Waktu resi dicetak', 'o.printed_at'],
  ['batas',    'Batas kirim',      'o.ship_by_date'],
  ['nilai',    'Nilai pesanan',    'o.total_amount'],
  ['kurir',    'Kurir',            'o.carrier'],
  ['toko',     'Toko',             's.shop_name'],
  ['sku',      'SKU toko',         'SKU'],
  ['jumlah',   'Jumlah barang',    'JML'],
];
export const cariUrut = (k) => URUT.find((u) => u[0] === k) || URUT[0];

/** Daftar pesanan untuk ditampilkan di layar, satu halaman sekali. */
export async function daftar(opsi = {}) {
  const { where, params } = saring(opsi);
  const u = cariUrut(opsi.urut);
  const arah = opsi.arah === 'naik' ? 'ASC' : 'DESC';
  const urutan = u[2] === 'SKU'
    // Pesanan ber-SKU banyak selalu di belakang, apa pun arahnya.
    ? `(COUNT(DISTINCT COALESCE(oi.model_sku, oi.item_sku)) > 1),
       MIN(COALESCE(oi.model_sku, oi.item_sku)) ${arah} NULLS LAST`
    : u[2] === 'JML'
      ? `COALESCE(SUM(oi.qty),0) ${arah}`
      : `${u[2]} ${arah} NULLS LAST`;
  const perHalaman = PER_HALAMAN.includes(Number(opsi.perHalaman)) ? Number(opsi.perHalaman) : 50;
  const halaman = Math.max(Number(opsi.halaman) || 1, 1);
  const lewati = (halaman - 1) * perHalaman;
  return q(`
    SELECT o.*, s.shop_name,
           COALESCE(json_agg(json_build_object(
             'nama', oi.item_name, 'sku', COALESCE(oi.model_sku, oi.item_sku),
             'qty', oi.qty, 'harga', oi.price, 'gambar', oi.image_url
           ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS item,
           (o.ship_by_date IS NOT NULL AND o.ship_by_date < now())            AS lewat,
           (o.ship_by_date IS NOT NULL AND o.ship_by_date >= now()
            AND o.ship_by_date < now() + interval '24 hours')                 AS segera
    FROM orders o
    LEFT JOIN shops s ON s.shop_id = o.shop_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE ${where}
    GROUP BY o.id, s.shop_name
    ORDER BY ${urutan}, o.id DESC
    LIMIT ${perHalaman} OFFSET ${lewati}`, params);
}

/** Satu baris per SKU — bentuk yang sama seperti ekspor BigSeller. */
export const KOLOM_EKSPOR = [
  ['No. Pesanan',        (o) => o.order_sn],
  ['Status',             (o) => o.status],
  ['Tahap',              (o) => o.tahap],
  ['Toko',               (o) => o.shop_name || `Toko ${o.shop_id}`],
  ['Marketplace',        () => 'Shopee'],
  ['Pembeli',            (o) => o.buyer_username],
  ['Nama penerima',      (o) => o.recipient_name],
  ['Telepon',            (o) => o.phone],
  ['Provinsi',           (o) => o.region],
  ['Kota',               (o) => o.city],
  ['Kecamatan',          (o) => o.district],
  ['Kode pos',           (o) => o.zipcode],
  ['Alamat',             (o) => o.address],
  ['SKU toko',           (o) => o.sku],
  ['Master SKU',         (o) => o.master_code],
  ['Nama produk',        (o) => o.item_name],
  ['Jumlah',             (o) => Number(o.qty) || 0],
  ['Harga satuan',       (o) => Number(o.price) || 0],
  ['Subtotal',           (o) => (Number(o.qty) || 0) * (Number(o.price) || 0)],
  ['HPP satuan',         (o) => Number(o.hpp) || 0],
  ['HPP subtotal',       (o) => (Number(o.qty) || 0) * (Number(o.hpp) || 0)],
  ['Total pesanan',      (o) => Number(o.total_amount) || 0],
  ['Dana diterima',      (o) => Number(o.escrow_amount) || 0],
  ['Komisi',             (o) => Number(o.commission_fee) || 0],
  ['Biaya layanan',      (o) => Number(o.service_fee) || 0],
  ['Kurir',              (o) => o.carrier],
  ['No. resi',           (o) => o.tracking_no],
  ['Metode bayar',       (o) => o.payment_method],
  ['Waktu pesan',        (o) => wkt(o.created_time)],
  ['Waktu dibayar',      (o) => wkt(o.paid_at)],
  ['Batas kirim',        (o) => wkt(o.ship_by_date)],
  ['Sisa waktu kirim',   (o) => sisa(o.ship_by_date)],
  ['Resi dicetak',       (o) => wkt(o.printed_at)],
  ['Selesai dikemas',    (o) => wkt(o.packed_at)],
  ['Waktu dikirim',      (o) => wkt(o.ship_time)],
  ['Waktu selesai',      (o) => wkt(o.completed_at)],
  ['Alasan batal',       (o) => o.cancel_reason],
  ['Catatan pembeli',    (o) => o.buyer_message],
  ['Stok gudang dipotong', (o) => (o.stock_applied ? 'Ya' : 'Tidak')],
];

const wkt = (d) => d
  ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit',
      month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace('.', ':')
  : '';

function sisa(d) {
  if (!d) return '';
  const m = (new Date(d).getTime() - Date.now()) / 60000;
  if (m < 0) return `lewat ${Math.floor(-m / 60)} jam`;
  return m < 60 ? `${Math.round(m)} menit` : `${Math.floor(m / 60)} jam`;
}

export async function barisEkspor(opsi = {}) {
  const { where, params } = saring(opsi);
  const rows = await q(`
    SELECT o.*, s.shop_name,
           oi.item_name, oi.qty, oi.price,
           COALESCE(oi.model_sku, oi.item_sku) AS sku,
           ms.code AS master_code,
           hpp_pada(ms.id, (o.created_time AT TIME ZONE 'Asia/Jakarta')::date) AS hpp,
           e.escrow_amount, e.commission_fee, e.service_fee,
           CASE
             WHEN o.status = 'UNPAID' THEN 'Belum dibayar'
             WHEN o.status IN ('CANCELLED','IN_CANCEL','TO_RETURN') THEN 'Batal'
             WHEN o.status = 'COMPLETED' THEN 'Selesai'
             WHEN o.status IN ('SHIPPED','TO_CONFIRM_RECEIVE') THEN 'Dikirim'
             WHEN o.packed_at IS NOT NULL THEN 'Siap dijemput'
             WHEN o.printed_at IS NOT NULL THEN 'Sedang dikemas'
             ELSE 'Pesanan baru'
           END AS tahap
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN shops s ON s.shop_id = o.shop_id
    LEFT JOIN order_escrow e ON e.order_id = o.id
    LEFT JOIN sku_mapping m ON m.shop_id = o.shop_id
          AND m.shop_sku = COALESCE(oi.model_sku, oi.item_sku)
    LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
    WHERE ${where}
    ORDER BY o.created_time DESC, oi.id
    LIMIT 20000`, params);

  return {
    header: KOLOM_EKSPOR.map(([h]) => h),
    rows: rows.map((r) => KOLOM_EKSPOR.map(([, f]) => f(r) ?? '')),
    jumlah: rows.length,
  };
}

/**
 * Ekspor memakai susunan kolom pilihan sendiri.
 *
 * Bentuk barisnya SATU BARIS PER SKU, sama seperti ekspor BigSeller —
 * pesanan berisi tiga barang menghasilkan tiga baris. Itu yang membuat
 * hasilnya bisa dipakai untuk sortir per SKU maupun dijumlahkan lewat
 * pivot tanpa diolah lagi.
 */
export async function barisEksporPilihan(opsi = {}, kunci = []) {
  const { petaKolom } = await import('./kolom-ekspor');
  const kolom = kunci.map((k) => petaKolom.get(k)).filter(Boolean);
  if (!kolom.length) throw new Error('Tidak ada kolom yang dipilih');

  const { where, params } = saring(opsi);
  const u = cariUrut(opsi.urut);
  const arah = opsi.arah === 'naik' ? 'ASC' : 'DESC';
  // Ekspor mengikuti urutan yang sama dengan layar. Untuk pengurutan
  // berbasis SKU, di sini yang dipakai SKU baris itu sendiri — bukan SKU
  // terkecil per pesanan seperti di daftar — karena bentuknya memang sudah
  // satu baris per SKU.
  const urutan = u[2] === 'SKU'
    ? `COALESCE(oi.model_sku, oi.item_sku) ${arah} NULLS LAST`
    : u[2] === 'JML' ? `oi.qty ${arah}`
    : `${u[2]} ${arah} NULLS LAST`;

  const rows = await q(`
    WITH ringkas AS (
      /**
       * Jenis pesanan, dihitung per PESANAN (bukan per baris barang).
       *
       *   Produk Campur        — mengandung Master SKU paket (bundling),
       *                          ATAU berisi lebih dari satu SKU berbeda
       *   Banyak Produk 1 Jenis— satu SKU saja, tapi jumlahnya lebih dari 1
       *   Produk Tunggal 1 Jenis — satu SKU, satu buah
       *
       * Paket bundling dihitung campur karena isinya memang beberapa barang
       * berbeda, walau di pesanan tampil sebagai satu baris.
       */
      SELECT oi2.order_id,
             COUNT(DISTINCT COALESCE(oi2.model_sku, oi2.item_sku)) AS sku_beda,
             SUM(oi2.qty)                                          AS total_qty,
             BOOL_OR(ms2.kind = 'paket')                           AS ada_paket
        FROM order_items oi2
        JOIN orders o2 ON o2.id = oi2.order_id
        LEFT JOIN sku_mapping m2 ON m2.shop_id = o2.shop_id
              AND m2.shop_sku = COALESCE(oi2.model_sku, oi2.item_sku)
        LEFT JOIN master_sku ms2 ON ms2.id = m2.master_sku_id
       GROUP BY oi2.order_id
    )
    SELECT o.*, s.shop_name,
           oi.item_name, oi.qty, oi.price, oi.item_id, oi.model_sku, oi.image_url,
           COALESCE(oi.model_sku, oi.item_sku) AS sku,
           CASE
             WHEN COALESCE(rk.ada_paket, false) OR COALESCE(rk.sku_beda, 1) > 1
               THEN 'Produk Campur'
             WHEN COALESCE(rk.total_qty, 1) > 1 THEN 'Banyak Produk 1 Jenis'
             ELSE 'Produk Tunggal 1 Jenis'
           END AS jenis_pesanan,
           ms.code AS master_code, ms.name AS master_name, ms.unit AS master_unit,
           hpp_pada(ms.id, (o.created_time AT TIME ZONE 'Asia/Jakarta')::date) AS hpp,
           e.escrow_amount, e.commission_fee, e.service_fee, e.gross_amount,
           e.seller_discount, e.shopee_subsidy, e.release_at,
           CASE
             WHEN o.status = 'UNPAID' THEN 'Belum dibayar'
             WHEN o.status IN ('CANCELLED','IN_CANCEL','TO_RETURN') THEN 'Batal'
             WHEN o.status = 'COMPLETED' THEN 'Selesai'
             WHEN o.status IN ('SHIPPED','TO_CONFIRM_RECEIVE') THEN 'Dikirim'
             WHEN o.disisihkan_at IS NOT NULL THEN 'Disisihkan'
             WHEN o.packed_at IS NOT NULL THEN 'Siap dijemput'
             WHEN o.ship_arranged_at IS NOT NULL THEN 'Sedang dikemas'
             ELSE 'Pesanan baru'
           END AS tahap
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN shops s ON s.shop_id = o.shop_id
    LEFT JOIN order_escrow e ON e.order_id = o.id
    LEFT JOIN sku_mapping m ON m.shop_id = o.shop_id
          AND m.shop_sku = COALESCE(oi.model_sku, oi.item_sku)
    LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
    LEFT JOIN ringkas rk ON rk.order_id = o.id
    WHERE ${where}
    ORDER BY ${urutan}, o.id DESC, oi.id
    LIMIT 50000`, params);

  return {
    header: kolom.map((k) => k[1]),
    rows: rows.map((r) => kolom.map((k) => {
      const v = k[4](r);
      return v === null || v === undefined ? '' : v;
    })),
    jumlah: rows.length,
  };
}
