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

/**
 * Tahap kerja gudang DI DALAM "Perlu Dikirim". Bukan lagi tab/sub-menu —
 * dipakai sebagai saringan "Tahap proses" (parameter ?tahap=) dan sebagai
 * label per pesanan, supaya tombol Pack / Cetak resi / Scan tetap tahu
 * pesanan mana yang sedang di tahap apa.
 */
export const TAHAP = [
  { key: 'baru',    label: 'Belum diproses',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NULL AND o.pack_gagal_at IS NULL
           AND o.disisihkan_at IS NULL`,
    jelas: 'Belum di-Pack — pengirimannya belum diatur ke marketplace' },
  { key: 'gagalpack', label: 'Proses gagal',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NULL AND o.disisihkan_at IS NULL
           AND o.pack_gagal_at IS NOT NULL AND o.pack_gagal_jenis = 'gagal'`,
    jelas: 'Ditolak Shopee saat Pack — perlu ditindak sebelum dicoba lagi' },
  { key: 'verifikasi', label: 'Menunggu marketplace',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NULL AND o.disisihkan_at IS NULL
           AND o.pack_gagal_at IS NOT NULL AND o.pack_gagal_jenis = 'marketplace'`,
    jelas: 'Shopee belum siap memproses pesanan ini — coba Pack lagi nanti' },
  { key: 'sisih', label: 'Disisihkan',
    cond: `${PRA_KIRIM} AND o.disisihkan_at IS NOT NULL`,
    jelas: 'Ditahan sendiri — tidak ikut diproses sampai dikembalikan' },
  // Syaratnya HANYA ship_arranged_at: resi instan boleh dicetak sebelum
  // Pack, dan pesanan yang belum diatur pengirimannya tidak boleh masuk
  // tahap yang jadi sumber Scan & Kirim, karena resinya memang belum ada.
  { key: 'proses',  label: 'Sedang dikemas',
    cond: `${PRA_KIRIM} AND o.ship_arranged_at IS NOT NULL AND o.packed_at IS NULL
           AND o.disisihkan_at IS NULL`,
    jelas: 'Sudah di-Pack, resi terbit, sedang dikemas' },
  { key: 'pickup',  label: 'Siap dijemput',
    cond: `${PRA_KIRIM} AND o.packed_at IS NOT NULL`,
    jelas: 'Selesai dikemas, menunggu kurir' },
  { key: 'mintabatal', label: 'Diminta batal pembeli',
    cond: `o.status = 'IN_CANCEL'`,
    jelas: 'Pembeli minta batal — menunggu keputusanmu' },
];
export const cariTahap = (k) => TAHAP.find((t) => t.key === k) || null;

export { tahapPesanan } from './tahap';

/**
 * Status utama — disamakan dengan Gurita Market: tujuh kartu, tanpa
 * sub-menu. Tahap gudang ada di saringan "Tahap proses".
 */
export const STATUS = [
  { key: 'semua',   label: 'Semua',          cond: `TRUE`,
    jelas: 'Tanpa penyaringan status' },
  { key: 'unpaid',  label: 'Belum Bayar',    cond: `o.status = 'UNPAID'`,
    jelas: 'Menunggu pembayaran pembeli' },
  { key: 'perlu',   label: 'Perlu Dikirim',  cond: PRA_KIRIM,
    jelas: 'Sudah dibayar dan belum diserahkan ke kurir' },
  { key: 'dikirim', label: 'Dikirim',        cond: `o.status IN ('SHIPPED','TO_CONFIRM_RECEIVE')`,
    jelas: 'Dalam perjalanan' },
  { key: 'selesai', label: 'Selesai',        cond: `o.status = 'COMPLETED'`,
    jelas: 'Pesanan selesai' },
  { key: 'batal',   label: 'Pembatalan',     cond: `o.status IN ('CANCELLED','IN_CANCEL')`,
    jelas: 'Sudah dibatalkan atau sedang diminta batal' },
  // Pengembalian: status TO_RETURN, ATAU punya pengajuan retur/refund
  // (tabel returns / tiktok_returns, keduanya berindeks per nomor pesanan).
  { key: 'retur',   label: 'Pengembalian',
    cond: `(o.status = 'TO_RETURN'
            OR (o.platform = 'shopee' AND EXISTS (SELECT 1 FROM returns rr WHERE rr.order_sn = o.order_sn))
            OR (o.platform = 'tiktok' AND EXISTS (SELECT 1 FROM tiktok_returns tr WHERE tr.order_id = o.order_sn)))`,
    jelas: 'Diretur atau diajukan pengembalian dana' },
];

/**
 * Kunci lama (sebelum disamakan dengan Gurita) masih dikenali, supaya
 * tautan tersimpan, tombol "Kembali ke Sedang dikemas" di layar Scan, dll.
 * tetap jalan: ?s=proses → Perlu Dikirim + tahap Sedang dikemas.
 */
export function terjemahLama(s) {
  const k = String(s || '').split(',')[0];
  if (['baru', 'gagalpack', 'verifikasi', 'sisih', 'proses', 'pickup'].includes(k)) {
    return { s: 'perlu', tahap: k };
  }
  if (k === 'mintabatal') return { s: 'batal', tahap: 'mintabatal' };
  return null;
}

export const cariStatus = (k) => STATUS.find((s) => s.key === k) || STATUS[0];

/**
 * ── Marketplace ──
 *
 * Halaman Pesanan membaca view `pesanan_v` (db/schema.sql) yang berisi
 * pesanan Shopee DAN TikTok dalam bentuk yang sama. Penyaring marketplace
 * adalah saklar: tidak ada yang dinyalakan = semua marketplace. Tujuan
 * utamanya memisahkan tumpukan saat cetak resi, karena jenis labelnya beda.
 *
 * Parameter `mp` boleh 'shopee', 'tiktok', atau keduanya dipisah koma;
 * keduanya sama dengan tidak menyaring. Nilai lain dibuang.
 */
export const MARKETPLACE = [
  ['shopee', 'Shopee'],
  ['tiktok', 'TikTok'],
];
export function kunciMp(mp) {
  const sah = String(mp || '').split(',').map((x) => x.trim().toLowerCase())
    .filter((x) => MARKETPLACE.some(([k]) => k === x));
  const unik = [...new Set(sah)];
  return unik.length === 1 ? unik : [];   // [] = semua
}

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

/**
 * Tipe pengiriman, ditebak dari NAMA layanan kurir (o.carrier) — Shopee dan
 * TikTok tidak mengirim kolom "jenis layanan" tersendiri, tapi namanya
 * selalu memuatnya: "SPX Instant", "SPX Hemat", "J&T Cargo", "… Next Day".
 * "Reguler" = sisanya: kurir terisi tapi tidak cocok pola mana pun.
 *
 * Polanya konstanta di sini, BUKAN dari alamat halaman — parameter `tipe`
 * hanya dicocokkan ke kunci daftar ini.
 */
const POLA_TIPE = {
  instan:  'instan|same ?day|sameday',
  nextday: 'next ?day',
  hemat:   'hemat|econom|ekonom',
  kargo:   'cargo|kargo|trucking',
};
export const TIPE_KIRIM = [
  ['instan',       'Instan / Sameday'],
  ['bukan-instan', 'Bukan instan'],
  ['nextday',      'Next Day'],
  ['reguler',      'Reguler'],
  ['hemat',        'Hemat'],
  ['kargo',        'Kargo'],
];
function kondisiTipe(tipe) {
  const k = `COALESCE(o.carrier,'')`;
  if (POLA_TIPE[tipe]) return `${k} ~* '${POLA_TIPE[tipe]}'`;
  if (tipe === 'bukan-instan') return `NOT (${k} ~* '${POLA_TIPE.instan}')`;
  if (tipe === 'reguler') {
    return `NULLIF(TRIM(${k}),'') IS NOT NULL AND NOT (${k} ~* '${Object.values(POLA_TIPE).join('|')}')`;
  }
  return null;
}

function saring({ status = 'baru', shopId = null, kadaluarsa = null, cari = null, kurir = null,
                 waktu = null, cetak = null, mp = null, tipe = null, tahap = null }) {
  const w = [kondisiStatus(status)];
  const th = cariTahap(tahap);
  if (th) w.push(`(${th.cond})`);
  const p = [];
  const plat = kunciMp(mp);
  if (plat.length) { p.push(plat[0]); w.push(`o.platform = $${p.length}`); }

  // Sudah/belum dicetak. Dasarnya print_count, yang kini hanya naik setelah
  // operator memastikan kertasnya keluar — jadi "belum dicetak" benar-benar
  // berarti labelnya belum ada di meja, bukan sekadar PDF-nya belum dibuka.
  if (cetak === 'belum') w.push('COALESCE(o.print_count,0) = 0');
  if (cetak === 'sudah') w.push('COALESCE(o.print_count,0) > 0');
  const syaratTipe = kondisiTipe(tipe);
  if (syaratTipe) w.push(`(${syaratTipe})`);

  // Pesanan yang kolom waktunya masih kosong memang sengaja tidak ikut:
  // menyaring "waktu pembayaran" tidak boleh memunculkan pesanan yang
  // belum dibayar sama sekali.
  if (waktu?.dari && waktu?.sampai) {
    const kol = cariBasis(waktu.basis)[2];
    p.push(waktu.dari); w.push(`${kol} >= $${p.length}`);
    p.push(waktu.sampai); w.push(`${kol} < $${p.length}`);
  }
  // shop_id di view berbentuk TEKS (id toko TikTok bukan angka).
  if (shopId) { p.push(String(shopId)); w.push(`o.shop_id = $${p.length}`); }
  if (kadaluarsa === 'lewat')  w.push(`o.ship_by_date IS NOT NULL AND o.ship_by_date < now()`);
  if (kadaluarsa === 'segera') w.push(`o.ship_by_date IS NOT NULL AND o.ship_by_date >= now() AND o.ship_by_date < now() + interval '24 hours'`);
  if (kurir === '(kosong)') w.push(`NULLIF(TRIM(COALESCE(o.carrier,'')),'') IS NULL`);
  else if (kurir) { p.push(kurir); w.push(`o.carrier = $${p.length}`); }
  if (cari) {
    p.push(`%${String(cari).trim()}%`);
    const n = p.length;
    // Termasuk SKU dan nama barang. Dipakai EXISTS, bukan JOIN, supaya satu
    // pesanan tidak muncul berkali-kali hanya karena punya banyak barang.
    //
    // Dua cabang per marketplace, langsung ke tabelnya masing-masing —
    // BUKAN lewat pesanan_item_v. Id TikTok di view adalah hasil hitungan,
    // jadi mencocokkannya per baris tidak bisa memakai indeks dan akan
    // menyapu seluruh baris TikTok untuk setiap pesanan.
    w.push(`(o.order_sn ILIKE $${n} OR o.tracking_no ILIKE $${n}
             OR o.recipient_name ILIKE $${n} OR o.package_number ILIKE $${n}
             OR (o.platform = 'shopee' AND EXISTS (
                   SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id
                      AND (oi2.item_sku ILIKE $${n} OR oi2.model_sku ILIKE $${n}
                           OR oi2.item_name ILIKE $${n})))
             OR (o.platform = 'tiktok' AND EXISTS (
                   SELECT 1 FROM tiktok_order_items ti2 WHERE ti2.order_id = o.order_sn
                      AND (ti2.seller_sku ILIKE $${n} OR ti2.product_name ILIKE $${n}))))`);
  }
  return { where: w.join(' AND '), params: p };
}

/**
 * Jumlah pesanan per status — untuk angka di kartu status.
 *
 * Memakai SEMUA saringan yang sedang aktif (toko, cetak, tipe, ekspedisi,
 * batas kirim, pencarian, waktu) kecuali status itu sendiri. Kalau tidak,
 * kartu bilang 400 sementara daftarnya berisi 12.
 */
export async function hitungStatus(opsi = {}) {
  const bagian = STATUS.filter((s) => s.key !== 'semua')
    .map((s) => `SUM(CASE WHEN ${s.cond} THEN 1 ELSE 0 END)::int AS ${s.key}`).join(',\n           ');
  const tahap = TAHAP.map((t) => `SUM(CASE WHEN ${t.cond} THEN 1 ELSE 0 END)::int AS t_${t.key}`)
    .join(',\n           ');
  // Saringan tahap sengaja dilepas: angka di kartu dan di dropdown Tahap
  // proses harus tetap menunjukkan isi tiap pilihan, bukan hanya yang dipilih.
  const { where, params } = saring({ ...opsi, status: 'semua', tahap: null });
  const rows = await q(`
    SELECT ${bagian},
           ${tahap},
           COUNT(*)::int AS semua,
           SUM(CASE WHEN o.ship_by_date IS NOT NULL AND o.ship_by_date < now()
                     AND ${PRA_KIRIM} THEN 1 ELSE 0 END)::int AS lewat,
           SUM(CASE WHEN o.ship_by_date IS NOT NULL AND o.ship_by_date >= now()
                     AND o.ship_by_date < now() + interval '24 hours'
                     AND ${PRA_KIRIM} THEN 1 ELSE 0 END)::int AS segera
    FROM pesanan_v o
    WHERE ${where}`, params);
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
  // Daftar kurirnya ikut saklar marketplace: menyalakan TikTok saja tidak
  // perlu memamerkan dua puluh kurir Shopee berangka nol.
  const plat = kunciMp(opsi.mp);
  const syaratMp = plat.length ? `AND platform = '${plat[0]}'` : '';
  return q(`
    WITH semua AS (
      SELECT DISTINCT COALESCE(NULLIF(TRIM(carrier),''), '(kosong)') AS kurir
        FROM pesanan_v
       WHERE created_time > now() - interval '90 days' ${syaratMp}
    ), terpakai AS (
      SELECT COALESCE(NULLIF(TRIM(o.carrier),''), '(kosong)') AS kurir,
             COUNT(*)::int AS jumlah
        FROM pesanan_v o
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
  const r = await q(`SELECT COUNT(*)::int AS n FROM pesanan_v o WHERE ${where}`, params);
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
  ['toko',     'Toko',             'o.shop_name'],
  ['sku',      'SKU toko',         'SKU'],
  ['jumlah',   'Jumlah barang',    'JML'],
];
export const cariUrut = (k) => URUT.find((u) => u[0] === k) || URUT[0];

/**
 * Daftar pesanan untuk ditampilkan di layar, satu halaman sekali.
 *
 * Dua langkah: pilih dulu satu halaman pesanan dari pesanan_v, BARU ambil
 * barangnya untuk pesanan-pesanan itu saja — langsung ke tabel masing-
 * masing marketplace lewat indeks. Dulu barang digabung sebelum memotong
 * halaman (GROUP BY o.id), dan itu tidak bisa dilakukan pada view yang
 * tidak punya kunci utama.
 */
export async function daftar(opsi = {}) {
  const { where, params } = saring(opsi);
  const u = cariUrut(opsi.urut);
  const arah = opsi.arah === 'naik' ? 'ASC' : 'DESC';
  const pakaiRingkas = u[2] === 'SKU' || u[2] === 'JML';
  const urutan = u[2] === 'SKU'
    // Pesanan ber-SKU banyak selalu di belakang, apa pun arahnya.
    ? `(COALESCE(rk.sku_beda,0) > 1), rk.sku_min ${arah} NULLS LAST`
    : u[2] === 'JML'
      ? `COALESCE(rk.jml,0) ${arah}`
      : `${u[2]} ${arah} NULLS LAST`;
  const perHalaman = PER_HALAMAN.includes(Number(opsi.perHalaman)) ? Number(opsi.perHalaman) : 50;
  const halaman = Math.max(Number(opsi.halaman) || 1, 1);
  const lewati = (halaman - 1) * perHalaman;
  const rows = await q(`
    ${pakaiRingkas ? `WITH rk AS (
      SELECT order_id,
             COUNT(DISTINCT COALESCE(model_sku, item_sku)) AS sku_beda,
             MIN(COALESCE(model_sku, item_sku))           AS sku_min,
             SUM(qty)                                      AS jml
        FROM pesanan_item_v GROUP BY order_id)` : ''}
    SELECT o.*,
           (o.ship_by_date IS NOT NULL AND o.ship_by_date < now())            AS lewat,
           (o.ship_by_date IS NOT NULL AND o.ship_by_date >= now()
            AND o.ship_by_date < now() + interval '24 hours')                 AS segera
    FROM pesanan_v o
    ${pakaiRingkas ? 'LEFT JOIN rk ON rk.order_id = o.id' : ''}
    WHERE ${where}
    ORDER BY ${urutan}, o.id DESC
    LIMIT ${perHalaman} OFFSET ${lewati}`, params);
  return lampirkanBarang(rows);
}

/** Tempelkan barang ke tiap pesanan di satu halaman. */
async function lampirkanBarang(rows) {
  const idShopee = rows.filter((o) => o.platform === 'shopee').map((o) => o.id);
  const snTiktok = rows.filter((o) => o.platform === 'tiktok').map((o) => o.order_sn);
  const [bs, bt] = await Promise.all([
    idShopee.length ? q(`
      SELECT order_id AS kunci, item_name AS nama, COALESCE(model_sku, item_sku) AS sku,
             qty, price AS harga, image_url AS gambar
        FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY id`, [idShopee]) : [],
    // TikTok menyimpan satu baris per UNIT — dikelompokkan jadi "× n".
    snTiktok.length ? q(`
      SELECT order_id AS kunci, product_name AS nama, seller_sku AS sku,
             COUNT(*)::int AS qty, sale_price AS harga, MAX(sku_image) AS gambar,
             MIN(line_item_id) AS urut
        FROM tiktok_order_items WHERE order_id = ANY($1::text[])
       GROUP BY order_id, product_name, seller_sku, sale_price
       ORDER BY MIN(line_item_id)`, [snTiktok]) : [],
  ]);
  const peta = new Map();
  for (const b of bs) {
    const k = `s:${b.kunci}`;
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push({ nama: b.nama, sku: b.sku, qty: b.qty, harga: b.harga, gambar: b.gambar });
  }
  for (const b of bt) {
    const k = `t:${b.kunci}`;
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push({ nama: b.nama, sku: b.sku, qty: b.qty, harga: b.harga, gambar: b.gambar });
  }
  return rows.map((o) => ({
    ...o,
    item: peta.get(o.platform === 'tiktok' ? `t:${o.order_sn}` : `s:${o.id}`) || [],
  }));
}

/** Satu baris per SKU — bentuk yang sama seperti ekspor BigSeller. */
export const KOLOM_EKSPOR = [
  ['No. Pesanan',        (o) => o.order_sn],
  ['Status',             (o) => o.status_asli || o.status],
  ['Tahap',              (o) => o.tahap],
  ['Toko',               (o) => o.shop_name || `Toko ${o.shop_id}`],
  ['Marketplace',        (o) => (o.platform === 'tiktok' ? 'TikTok' : 'Shopee')],
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

/**
 * Penautan ke Master SKU untuk ekspor, per marketplace.
 *
 * Shopee lewat sku_mapping dengan DUA jalur terpisah (model_sku lalu
 * item_sku), sama seperti lib/report.js — satu COALESCE saja membuat baris
 * yang model_sku-nya terisi tapi tidak tertaut tidak pernah mencoba
 * item_sku. TikTok lewat tiktok_sku_mapping per seller_sku.
 *
 * shop_id di view berbentuk teks, jadi untuk Shopee diubah balik ke angka —
 * di dalam CASE supaya id toko TikTok tidak pernah ikut diubah.
 */
const JOIN_MASTER = `
    LEFT JOIN sku_mapping mm ON o.platform = 'shopee'
          AND mm.shop_id = (CASE WHEN o.platform = 'shopee' THEN o.shop_id::bigint END)
          AND mm.shop_sku = NULLIF(TRIM(oi.model_sku),'')
    LEFT JOIN sku_mapping mi ON o.platform = 'shopee'
          AND mi.shop_id = (CASE WHEN o.platform = 'shopee' THEN o.shop_id::bigint END)
          AND mi.shop_sku = NULLIF(TRIM(oi.item_sku),'')
    LEFT JOIN tiktok_sku_mapping mt ON o.platform = 'tiktok'
          AND mt.shop_id = o.shop_id AND mt.seller_sku = oi.item_sku
    LEFT JOIN master_sku ms ON ms.id = COALESCE(mm.master_sku_id, mi.master_sku_id, mt.master_sku_id)`;

export async function barisEkspor(opsi = {}) {
  const { where, params } = saring(opsi);
  const rows = await q(`
    SELECT o.*,
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
    FROM pesanan_v o
    JOIN pesanan_item_v oi ON oi.order_id = o.id
    LEFT JOIN order_escrow e ON e.order_id = o.id
    ${JOIN_MASTER}
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
  // Kolom urut di URUT memakai awalan `o.`; di sini barisnya dibaca dari
  // CTE `dasar` (alias d), jadi awalannya diganti.
  const urutan = u[2] === 'SKU'
    ? `d.sku ${arah} NULLS LAST`
    : u[2] === 'JML' ? `d.qty ${arah}`
    : `${u[2].replace(/^o\./, 'd.')} ${arah} NULLS LAST`;

  const rows = await q(`
    WITH dasar AS (
      SELECT o.*,
             oi.id AS oi_id, oi.item_name, oi.qty, oi.price, oi.item_id, oi.model_sku,
             oi.image_url,
             COALESCE(oi.model_sku, oi.item_sku) AS sku,
             ms.id AS ms_id, ms.kind AS ms_kind,
             ms.code AS master_code, ms.name AS master_name, ms.unit AS master_unit
        FROM pesanan_v o
        JOIN pesanan_item_v oi ON oi.order_id = o.id
        ${JOIN_MASTER}
       WHERE ${where}
    ),
    ringkas AS (
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
       *
       * Dihitung dari baris yang SUDAH tersaring, bukan seluruh tabel —
       * isinya sama karena satu pesanan selalu ikut utuh, dan jauh lebih
       * ringan daripada menyapu semua pesanan setiap kali ekspor.
       */
      SELECT id AS order_id,
             COUNT(DISTINCT sku)        AS sku_beda,
             SUM(qty)                   AS total_qty,
             BOOL_OR(ms_kind = 'paket') AS ada_paket
        FROM dasar GROUP BY id
    )
    SELECT d.*,
           CASE
             WHEN COALESCE(rk.ada_paket, false) OR COALESCE(rk.sku_beda, 1) > 1
               THEN 'Produk Campur'
             WHEN COALESCE(rk.total_qty, 1) > 1 THEN 'Banyak Produk 1 Jenis'
             ELSE 'Produk Tunggal 1 Jenis'
           END AS jenis_pesanan,
           hpp_pada(d.ms_id, (d.created_time AT TIME ZONE 'Asia/Jakarta')::date) AS hpp,
           e.escrow_amount, e.commission_fee, e.service_fee, e.gross_amount,
           e.seller_discount, e.shopee_subsidy, e.release_at,
           CASE
             WHEN d.status = 'UNPAID' THEN 'Belum dibayar'
             WHEN d.status IN ('CANCELLED','IN_CANCEL','TO_RETURN') THEN 'Batal'
             WHEN d.status = 'COMPLETED' THEN 'Selesai'
             WHEN d.status IN ('SHIPPED','TO_CONFIRM_RECEIVE') THEN 'Dikirim'
             WHEN d.disisihkan_at IS NOT NULL THEN 'Disisihkan'
             WHEN d.packed_at IS NOT NULL THEN 'Siap dijemput'
             WHEN d.ship_arranged_at IS NOT NULL THEN 'Sedang dikemas'
             ELSE 'Pesanan baru'
           END AS tahap
    FROM dasar d
    LEFT JOIN order_escrow e ON e.order_id = d.id
    LEFT JOIN ringkas rk ON rk.order_id = d.id
    ORDER BY ${urutan}, d.id DESC, d.oi_id
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
