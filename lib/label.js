import { q, one, log } from './db';
import { call, callBiner, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { PDFDocument, degrees } from 'pdf-lib';

/**
 * Bentuk label yang selalu diminta: satu label per halaman, ukuran termal
 * A6 — bentuk yang dipakai printer di gudang. Ditaruh di satu tempat
 * supaya kalau suatu hari Shopee mengganti namanya, cukup diubah di sini.
 */
const JENIS_LABEL = 'THERMAL_AIR_WAYBILL';
import { tokenHidup } from './tokens';

/**
 * ── Cetak resi (Tahap 2 modul Logistics) ──
 *
 * Membuat dokumen TIDAK mengirim pesanan dan tidak bisa merusak apa pun —
 * ia hanya menyiapkan label untuk pesanan yang pengirimannya SUDAH diatur.
 * Karena itu tahap ini aman dibangun sebelum ship_order.
 *
 * Alurnya empat langkah, dan tidak bisa dipotong:
 *   1. get_shipping_document_parameter  → jenis label apa yang tersedia
 *   2. create_shipping_document         → minta Shopee menyiapkannya
 *   3. get_shipping_document_result     → tunggu sampai siap
 *   4. download_shipping_document       → ambil PDF-nya
 */

const MAKS_SEKALI = 50;   // batas wajar Shopee per panggilan

/**
 * Ambil alasan gagal per pesanan. Nama kolomnya berbeda-beda antar endpoint
 * Shopee, jadi semua kemungkinan diperiksa — kalau tidak, yang tersisa cuma
 * "All failed" yang tidak menjelaskan apa pun.
 */
function pesanGagal(daftar) {
  return (daftar || [])
    .map((x) => {
      const sebab = x.fail_message || x.fail_error || x.failed_reason
                 || x.error_description || x.message || x.status_description
                 || (String(x.status || '').toUpperCase() === 'FAILED' ? 'FAILED tanpa keterangan' : null);
      return sebab ? `${x.order_sn || '?'}: ${sebab}` : null;
    })
    .filter(Boolean)
    .slice(0, 3);
}

/** Alasan dari error yang dilempar — result_list-nya ikut di err.respons. */
function sebabDariError(e) {
  const dalam = pesanGagal(e?.respons?.result_list || e?.respons?.info_list);
  if (dalam.length) return dalam;
  return [`${e.shopeeCode ? e.shopeeCode + ': ' : ''}${e.message}`];
}

/** Jenis label yang disarankan Shopee untuk tiap pesanan. */
async function jenisLabel(token, shopId, sns) {
  let json;
  try {
    json = await call(EP.docParam, {
      accessToken: token, shopId,
      body: { order_list: sns.map((order_sn) => ({ order_sn })) },
    });
  } catch (e) {
    return { peta: new Map(), gagal: sebabDariError(e) };
  }
  const info = json.response?.result_list || json.response?.info_list || [];
  const peta = new Map();
  for (const x of info) {
    /**
     * THERMAL_AIR_WAYBILL DIPAKSA kalau tersedia.
     *
     * Dulu yang dipakai `suggest_shipping_document_type` — apa pun yang
     * disarankan Shopee. Untuk sebagian pesanan sarannya
     * NORMAL_AIR_WAYBILL, dan itu berbentuk kertas besar berisi DUA label
     * berdampingan. Akibatnya dua hal sekaligus:
     *
     *  1. Halamannya tidak bisa dicetak di printer termal A6 — inilah
     *     halaman yang terlihat aneh di tumpukan.
     *  2. Pemetaan "satu halaman = satu label" jadi tidak berlaku, dan
     *     penyusunan ulang urutan menyerah lalu jatuh kembali ke urutan
     *     per toko. Itu sebabnya urutan SKU terasa per toko, bukan
     *     menyeluruh.
     *
     * Jadi satu perbaikan ini menutup dua keluhan sekaligus.
     */
    const pilihan = (x.selectable_shipping_document_type || [])
      .map((y) => (typeof y === 'string' ? y : y?.shipping_document_type))
      .filter(Boolean);
    const jenis = pilihan.includes(JENIS_LABEL)
      ? JENIS_LABEL
      : (x.suggest_shipping_document_type
         || pilihan[0]
         || (x.shipping_document_info || [])[0]?.shipping_document_type);
    // package_number WAJIB diikutkan untuk pesanan yang punya paket.
    // Tanpa itu Shopee gagal menentukan paket mana yang dimaksud dan
    // membalas "The tracking number is invalid".
    const paket = x.package_number
      || (x.package_list || [])[0]?.package_number
      || null;
    if (x.order_sn && jenis) peta.set(x.order_sn, { jenis, paket });
  }
  const gagal = pesanGagal(json.response?.result_list);
  return { peta, gagal };
}

/** Minta Shopee menyiapkan label, lalu tunggu sampai siap. */
async function siapkan(token, shopId, daftar) {
  let buat;
  try {
    buat = await call(EP.docBuat, { accessToken: token, shopId, body: { order_list: daftar } });
  } catch (e) {
    // "All failed" bukan akhir cerita — alasan sebenarnya ada di dalam.
    return { siap: [], gagal: sebabDariError(e) };
  }
  const gagalBuat = pesanGagal(buat.response?.result_list);

  // Penyiapan tidak selalu langsung selesai — ditunggu, tidak diasumsikan.
  for (let coba = 0; coba < 6; coba++) {
    await tidur(coba === 0 ? 800 : 1800);
    let cek;
    try {
      cek = await call(EP.docHasil, {
        accessToken: token, shopId,
        body: { order_list: daftar.map(({ order_sn, shipping_document_type, package_number }) =>
          package_number ? { order_sn, shipping_document_type, package_number }
                         : { order_sn, shipping_document_type }) },
      });
    } catch (e) {
      return { siap: [], gagal: [...gagalBuat, ...sebabDariError(e)] };
    }
    const hasil = cek.response?.result_list || [];
    const belum = hasil.filter((x) => String(x.status || '').toUpperCase() === 'PROCESSING');
    if (!belum.length) {
      const siap = hasil.filter((x) => String(x.status || '').toUpperCase() === 'READY').map((x) => x.order_sn);
      return { siap, gagal: [...gagalBuat, ...pesanGagal(hasil)] };
    }
  }
  return { siap: [], gagal: [...gagalBuat, 'Shopee belum selesai menyiapkan label setelah menunggu ~10 detik'] };
}

/**
 * Ambil label untuk sekumpulan pesanan dalam SATU toko.
 * Kembaliannya berkas PDF gabungan.
 */
/**
 * Label hanya ada kalau Shopee sudah menerbitkan nomor resi untuk pesanan itu.
 * Pesanan berstatus PROCESSED belum tentu sudah punya — resi baru terbit
 * setelah kurir mengonfirmasi. Diperiksa dulu di sini supaya kegagalannya
 * bisa dijelaskan dengan tepat, bukan disamaratakan.
 */
async function pastikanResi(token, shopId, sns) {
  const punya = new Map();
  const kosong = [];

  /**
   * ── Penghemat panggilan terbesar di seluruh alur cetak ──
   *
   * Nomor resi TIDAK PERNAH berubah setelah terbit, dan kita sudah
   * menyimpannya di kolom tracking_no saat sinkron maupun saat Pack.
   * Dulu fungsi ini tetap menanyakannya ke Shopee untuk SETIAP pesanan,
   * satu panggilan masing-masing dengan jeda 350 md di antaranya. Untuk
   * 100 pesanan itu 100 panggilan beruntun — sekitar 80 detik hanya untuk
   * mengambil angka yang sudah ada di database sendiri.
   *
   * Sekarang Shopee hanya ditanya untuk pesanan yang resinya memang belum
   * kita punya. Pada tumpukan cetak biasa, itu berarti nol panggilan.
   */
  const tersimpan = await q(
    `SELECT order_sn, tracking_no FROM orders
      WHERE shop_id = $1 AND order_sn = ANY($2::text[])
        AND NULLIF(TRIM(COALESCE(tracking_no,'')),'') IS NOT NULL`, [shopId, sns]);
  for (const r of tersimpan) punya.set(r.order_sn, r.tracking_no);

  const perluTanya = sns.filter((sn) => !punya.has(sn));
  for (const sn of perluTanya) {
    try {
      const json = await call(EP.trackingNumber, {
        accessToken: token, shopId, params: { order_sn: sn },
      });
      const r = json.response || {};
      const nomor = r.tracking_number || r.first_mile_tracking_number || r.plp_number || null;
      if (nomor) {
        punya.set(sn, nomor);
        await q('UPDATE orders SET tracking_no = $3 WHERE shop_id = $1 AND order_sn = $2',
          [shopId, sn, nomor]);
      } else {
        kosong.push(sn);
        // Kurir instan belum punya nomor resi saat ini, tapi punya kode
        // jemput — dan Shopee tetap mau membuatkan labelnya. Kodenya
        // disimpan supaya bisa ditampilkan di layar.
        if (r.pickup_code) {
          await q('UPDATE orders SET pickup_code = $3 WHERE shop_id = $1 AND order_sn = $2',
            [shopId, sn, String(r.pickup_code)]).catch(() => {});
        }
      }
    } catch {
      kosong.push(sn);
    }
    await tidur(JEDA_MS);
  }
  return { punya, kosong };
}

/** Satu rombongan, paling banyak MAKS_SEKALI pesanan. */
async function cetakSatuRombongan(shopId, orderSns, token) {

  const simpanan = await q(
    `SELECT order_sn, package_number FROM orders
     WHERE shop_id = $1 AND order_sn = ANY($2::text[])`, [shopId, orderSns]);
  const paketDb = new Map(simpanan.filter((x) => x.package_number)
    .map((x) => [x.order_sn, x.package_number]));

  /**
   * Nomor resi yang kosong TIDAK lagi menggugurkan pesanan.
   *
   * Dulu di sini ada penjaga yang menolak pesanan tanpa nomor resi, dengan
   * anggapan labelnya pasti belum ada. Untuk kurir reguler itu benar. Untuk
   * SPX Instant TIDAK: nomor resinya memang kosong sampai pengiriman diatur,
   * Shopee memakai pickup_code, dan ia tetap bersedia membuat labelnya —
   * terbukti lewat /api/diagnosa-label pada pesanan yang belum di-Pack.
   *
   * Jadi yang memutuskan sekarang Shopee sendiri lewat
   * get_shipping_document_parameter di bawah, bukan tebakan kita.
   */
  const { punya, kosong } = await pastikanResi(token, shopId, orderSns);
  const catatanAwal = [];

  const { peta, gagal: gagalParam } = await jenisLabel(token, shopId, orderSns);
  await tidur(JEDA_MS);

  const daftar = orderSns
    .filter((sn) => peta.has(sn))
    .map((order_sn) => {
      const { jenis, paket } = peta.get(order_sn);
      const nomorPaket = paketDb.get(order_sn) || paket || null;
      // tracking_number WAJIB dikirim eksplisit. Dokumentasi menandainya
      // opsional, tapi tanpa itu Shopee menolak dengan
      // "logistics.tracking_number_invalid" — nomor yang kosong memang
      // tidak sah. Terbukti lewat diagnosa: hanya kombinasi dengan
      // tracking_number yang diterima.
      // tracking_number dikirim HANYA kalau ada isinya. Untuk kurir reguler
      // Shopee memang menuntutnya — tanpa itu ia menolak dengan
      // "logistics.tracking_number_invalid". Tapi mengirim nilai KOSONG
      // untuk pesanan instan justru memicu penolakan yang sama, padahal
      // tanpa field itu permintaannya diterima.
      const baris = { order_sn, shipping_document_type: jenis };
      if (punya.get(order_sn)) baris.tracking_number = punya.get(order_sn);
      if (nomorPaket) baris.package_number = nomorPaket;
      return baris;
    });

  if (!daftar.length) {
    throw new Error(gagalParam[0]
      || (kosong.length
        ? 'Shopee belum mau membuat label untuk pesanan ini. Untuk kurir reguler, '
          + 'atur pengirimannya dulu lewat Pack — nomor resinya baru terbit setelah itu.'
        : 'Tidak ada pesanan yang labelnya bisa dibuat.'));
  }

  const { siap, gagal } = await siapkan(token, shopId, daftar);
  await tidur(JEDA_MS);

  const dipakai = daftar.filter((d) => siap.includes(d.order_sn));
  if (!dipakai.length) {
    const sebab = [...gagalParam, ...gagal][0] || 'Label tidak berhasil disiapkan Shopee';
    throw new Error(sebab + (await jelaskan(shopId, orderSns, sebab)));
  }

  const { buf } = await callBiner(EP.docUnduh, {
    accessToken: token, shopId,
    body: { order_list: dipakai },
  });

  /**
   * print_count TIDAK dinaikkan di sini.
   *
   * Dulu ia naik begitu PDF-nya jadi. Padahal "PDF berhasil dibuat" bukan
   * "kertasnya keluar": printer bisa macet, kertas habis, atau orangnya
   * batal mencetak. Akibatnya penjaga resi kembar ikut berbohong — pesanan
   * ditandai sudah dicetak padahal labelnya tidak pernah ada.
   *
   * Sekarang angkanya naik lewat /api/label/tandai, setelah operator
   * memastikan cetaknya berhasil.
   */
  await log('label', `Toko ${shopId}: ${dipakai.length} label dibuat`, { shopId });
  return {
    buf,
    dicetak: dipakai.map((d) => d.order_sn),
    jumlah: dipakai.length,
    dilewati: (orderSns.length - dipakai.length) + kosong.length,
    gagal: [...catatanAwal, ...gagalParam, ...gagal].slice(0, 3),
  };
}

/**
 * Cetak label untuk satu toko, berapa pun jumlahnya.
 *
 * Shopee hanya menerima MAKS_SEKALI pesanan per panggilan
 * create_shipping_document. Dulu kelebihannya DITOLAK — orang yang memilih
 * 227 pesanan harus memecahnya sendiri, per toko pula, dan itu pekerjaan
 * yang seharusnya dikerjakan aplikasi.
 *
 * Sekarang daftarnya dipecah sendiri, tiap potongan diminta terpisah, lalu
 * PDF-nya digabung. Batas Shopee tetap dihormati; yang hilang cuma
 * kewajiban orang menghitung manual.
 *
 * Rombongan dikerjakan BERURUTAN dengan jeda, bukan bersamaan: batas laju
 * Shopee dihitung per toko, jadi menembakkan lima panggilan sekaligus ke
 * toko yang sama justru memicu penolakan.
 */
export async function cetakLabel(shopId, orderSns) {
  if (!orderSns.length) throw new Error('Tidak ada pesanan dipilih');
  const token = await tokenHidup(shopId);

  const potongan = [];
  for (let i = 0; i < orderSns.length; i += MAKS_SEKALI) {
    potongan.push(orderSns.slice(i, i + MAKS_SEKALI));
  }

  const hasil = [];
  const gagalSemua = [];
  for (const [i, bagian] of potongan.entries()) {
    try {
      hasil.push(await cetakSatuRombongan(shopId, bagian, token));
    } catch (e) {
      // Satu rombongan gagal tidak boleh membatalkan yang lain — kalau
      // 200 pesanan dicetak dan potongan ketiga bermasalah, yang 150
      // lainnya tetap harus keluar.
      gagalSemua.push(`Rombongan ${i + 1}: ${e.message}`);
    }
    if (i < potongan.length - 1) await tidur(JEDA_MS);
  }

  if (!hasil.length) {
    throw new Error(gagalSemua[0] || 'Tidak ada label yang berhasil dibuat');
  }
  if (hasil.length === 1 && !gagalSemua.length) return hasil[0];

  const gabung = await gabungPdf(
    hasil.map((h, i) => ({ nama: `bagian-${i + 1}`, isi: h.buf, sns: h.dicetak })),
    orderSns);

  return {
    buf: Buffer.isBuffer(gabung) ? gabung : gabung.buf,
    dicetak: hasil.flatMap((h) => h.dicetak || []),
    jumlah: hasil.reduce((n, h) => n + h.jumlah, 0),
    dilewati: hasil.reduce((n, h) => n + h.dilewati, 0),
    gagal: [...gagalSemua, ...hasil.flatMap((h) => h.gagal || [])].slice(0, 3),
  };
}

/**
 * Terjemahkan pesan Shopee sesuai KEADAAN pesanannya.
 *
 * "The tracking number is invalid" muncul untuk beberapa sebab berbeda, dan
 * menyamaratakannya justru menyesatkan — versi sebelumnya selalu menuduh
 * batas kirim terlampaui, padahal pesanan yang masih punya sisa waktu pun
 * bisa gagal karena resinya memang belum terbit.
 */
async function jelaskan(shopId, sns, sebab) {
  if (/package_can_not_print|can not print/i.test(sebab)) {
    return ' — paketnya sudah dijemput kurir atau sudah sampai, jadi labelnya '
         + 'tidak bisa dicetak lagi lewat API. Ini normal, bukan kesalahan.';
  }
  if (!/tracking number is invalid/i.test(sebab)) return '';
  const r = await one(
    `SELECT
       SUM(CASE WHEN ship_by_date IS NOT NULL AND ship_by_date < now() THEN 1 ELSE 0 END)::int AS lewat,
       SUM(CASE WHEN NULLIF(TRIM(COALESCE(tracking_no,'')),'') IS NULL THEN 1 ELSE 0 END)::int AS tanpa_resi,
       SUM(CASE WHEN NULLIF(TRIM(COALESCE(package_number,'')),'') IS NULL THEN 1 ELSE 0 END)::int AS tanpa_paket,
       COUNT(*)::int AS jumlah
     FROM orders WHERE shop_id = $1 AND order_sn = ANY($2::text[])`, [shopId, sns]);

  // Lewat batas kirim TIDAK dengan sendirinya menghalangi cetak label —
  // selama pesanan masih aktif dan resinya berlaku, Shopee tetap melayaninya.
  // Karena itu keadaan disebutkan apa adanya, bukan dijadikan tuduhan.
  if (Number(r?.tanpa_resi) > 0) {
    return ' — pesanan ini belum punya nomor resi dari Shopee. Status PROCESSED belum '
         + 'berarti resinya sudah terbit; tunggu kurir mengonfirmasi, atau selesaikan '
         + 'pengaturan pengiriman di Seller Centre.';
  }
  if (Number(r?.tanpa_paket) > 0) {
    return ' — nomor paket pesanan ini belum tersimpan. Tekan Sinkron dulu supaya '
         + 'nomor paketnya ikut ditarik, lalu coba cetak lagi.';
  }
  const catatan = Number(r?.lewat) > 0
    ? ` (${r.lewat} dari ${r.jumlah} pesanan sudah lewat batas kirim, tapi itu belum tentu penyebabnya)`
    : '';
  return ` — periksa di Seller Centre apakah pengiriman pesanan ini masih berlaku${catatan}.`;
}

export async function periksaPilihan(ids) {
  // Urutannya HARUS sama dengan urutan yang dikirim layar. Tanpa ORDER BY,
  // Postgres bebas mengembalikan baris dalam urutan apa pun — dan itulah
  // yang membuat halaman PDF tidak mengikuti pengurutan di layar.
  const rows = await q(
    `SELECT o.id, o.order_sn, o.shop_id, s.shop_name, o.tracking_no
     FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.id = ANY($1::bigint[])
     ORDER BY array_position($1::bigint[], o.id)`, [ids]);
  const toko = [...new Set(rows.map((r) => String(r.shop_id)))];
  return { rows, toko };
}

/**
 * Gabungkan beberapa PDF jadi satu berkas.
 *
 * Shopee memang hanya bisa memberi satu PDF per toko — panggilannya terikat
 * pada satu shop_id. Tapi hasil akhirnya TIDAK harus terpisah: halaman dari
 * tiap toko disalin ke satu dokumen baru, urut sesuai urutan tokonya.
 * Inilah yang dilakukan BigSeller, dan tidak ada alasan kita tidak.
 */
async function gabungPdf(daftar, urutanDiminta = null) {
  const keluar = await PDFDocument.create();
  const gagal = [];

  // Kumpulkan seluruh halaman dari semua dokumen dulu, supaya ukuran yang
  // paling umum bisa ditentukan sebelum satu pun halaman ditulis.
  const halaman = [];
  for (const { nama, isi, sns } of daftar) {
    try {
      const src = await PDFDocument.load(isi, { ignoreEncryption: true });
      const idx = src.getPageIndices();
      // Kalau jumlah halaman PERSIS sama dengan jumlah label toko ini,
      // halaman ke-n adalah label pesanan ke-n — Shopee mengembalikannya
      // dalam urutan yang kita kirim.
      // Satu halaman = satu label? Kalau halamannya LEBIH SEDIKIT dari
      // jumlah label, berarti ada halaman yang memuat lebih dari satu
      // label — dan itu menentukan aman-tidaknya pemotongan di bawah.
      const cocok = Array.isArray(sns) && sns.length === idx.length;
      const padat = Array.isArray(sns) && sns.length > idx.length;
      if (padat) {
        gagal.push(`${nama}: satu halaman memuat lebih dari satu label. `
          + 'Halaman itu tidak dipotong maupun disusun ulang.');
      }
      idx.forEach((i, n) => halaman.push({
        src, h: src.getPage(i), sn: cocok ? sns[n] : null, tunggal: cocok,
      }));
    } catch (e) {
      gagal.push(`${nama}: PDF tidak terbaca (${e.message})`);
    }
  }

  /**
   * ── Halaman disusun ulang mengikuti urutan di layar ──
   *
   * Label dibuat per toko, jadi bawaannya halaman terkumpul per toko:
   * semua label toko A, baru toko B. Padahal orang menyortir di layar
   * berdasarkan SKU justru supaya bisa mengambil satu tumpuk barang
   * sekaligus — dan urutan itu lintas toko.
   *
   * Penyusunan ulang hanya dilakukan kalau SETIAP halaman bisa dipetakan
   * ke satu nomor pesanan. Kalau ada satu saja yang tidak (misalnya sebuah
   * label memakan dua halaman), urutan per toko dipertahankan — menebak
   * pemetaan halaman berisiko menukar label antar paket, dan itu jauh
   * lebih mahal daripada urutan yang kurang enak.
   */
  let disusunUlang = false;
  if (urutanDiminta?.length && halaman.length && halaman.every((x) => x.sn)) {
    const posisi = new Map(urutanDiminta.map((sn, i) => [sn, i]));
    if (halaman.every((x) => posisi.has(x.sn))) {
      halaman.sort((a, b) => posisi.get(a.sn) - posisi.get(b.sn));
      disusunUlang = true;
    }
  }
  if (!halaman.length) throw new Error(gagal[0] || 'Tidak ada halaman label yang bisa digabung');

  /** Ukuran halaman setelah memperhitungkan rotasi. */
  const ukur = (h) => {
    const { width, height } = h.getSize();
    const r = ((h.getRotation().angle % 360) + 360) % 360;
    return (r === 90 || r === 270) ? { w: height, t: width, r } : { w: width, t: height, r };
  };

  /**
   * Ukuran sasaran = ukuran yang PALING BANYAK dipakai.
   *
   * Label SPX Instant/Sameday terbit dengan ukuran halaman berbeda dari
   * resi biasa. Kalau halaman disalin apa adanya, satu berkas berisi
   * campuran ukuran, dan printer termal menskalakan tiap halaman
   * sendiri-sendiri — yang instan tercetak kecil, miring, atau terpotong.
   * Dengan memilih ukuran mayoritas, resi biasa tidak berubah sama sekali
   * dan hanya yang menyimpang yang disesuaikan.
   */
  const hitung = new Map();
  for (const x of halaman) {
    const u = ukur(x.h);
    const k = `${Math.round(u.w)}x${Math.round(u.t)}`;
    hitung.set(k, (hitung.get(k) || 0) + 1);
  }
  const terbanyak = [...hitung.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [tw, th] = terbanyak.split('x').map(Number);
  const seragam = hitung.size === 1;

  // Semua halaman sudah seukuran: kembalikan apa adanya. Menyalin ulang
  // dokumen yang sudah benar hanya menambah risiko tanpa manfaat.
  if (seragam && daftar.length === 1) return daftar[0].isi;

  let disesuaikan = 0;
  for (const { src, h, tunggal } of halaman) {
    const u = ukur(h);
    const samaUkuran = Math.abs(u.w - tw) < 2 && Math.abs(u.t - th) < 2;

    if (samaUkuran && u.r === 0) {
      const [salin] = await keluar.copyPages(src, [src.getPages().indexOf(h)]);
      keluar.addPage(salin);
      continue;
    }

    try {
      /**
       * ── Halaman lebih BESAR dari sasaran: dipotong, bukan diperkecil ──
       *
       * Ini perbaikan atas kesalahanku sendiri. Versi sebelumnya selalu
       * memperkecil seluruh halaman agar muat, dan itu benar hanya kalau
       * labelnya memang memenuhi halamannya.
       *
       * Kenyataannya Shopee kadang menaruh label berukuran normal di
       * kertas A4 — labelnya di pojok kiri atas, sisanya putih. Diperkecil
       * seluruhnya berarti area putihnya ikut diperhitungkan, dan labelnya
       * menyusut jadi setengah. Terukur di berkas nyata: tinta halaman itu
       * 203 px lebar sementara halaman normal 404 px — tepat 0,5×, persis
       * angka yang keluar dari A4 (595×842) diperkecil ke 297×419.
       *
       * Jadi kalau halaman jauh lebih besar, yang diambil adalah JENDELA
       * seukuran sasaran dari pojok KIRI ATAS, pada ukuran asli 100%.
       * Label memang ditaruh di situ — terbukti dari halaman yang normal:
       * tintanya selalu mulai di koordinat (2,2).
       *
       * Kalau selisihnya kecil (di bawah 1,2×), itu memang beda ukuran
       * kertas biasa, dan diperkecil proporsional seperti sebelumnya.
       */
      const asli = h.getSize();

      /**
       * Kapan dipotong, kapan diperkecil?
       *
       * Pembedanya BUKAN sekadar "lebih besar". Kertas A5 juga lebih besar
       * dari label 10×15, tapi labelnya memenuhi kertas — memotongnya
       * berarti membuang separuh label.
       *
       * Yang membedakan: kertas yang MEMUAT label berukuran normal selalu
       * kelipatan BULAT dari ukuran label itu — A4 persis 2× label 297×419
       * (595/297 = 2,003 dan 842/419 = 2,010). Sementara ukuran kertas yang
       * memang berbeda (A5 → 1,414×) tidak pernah bulat.
       *
       * Jadi: kelipatan bulat ≥ 2 pada KEDUA sisi → dipotong dari pojok
       * kiri atas pada ukuran asli. Selain itu → diperkecil proporsional
       * seperti sebelumnya.
       */
      const kx = u.w / tw, ky = u.t / th;
      const bulat = (r) => Math.abs(r - Math.round(r)) < 0.06 && Math.round(r) >= 2;

      /**
       * Pemotongan HANYA untuk halaman yang terbukti berisi satu label.
       *
       * Ini pengaman yang kurang di versi sebelumnya, dan bisa mahal:
       * Shopee kadang mengembalikan kertas besar berisi DUA label
       * berdampingan. Memotong pojok kiri atas pada halaman seperti itu
       * berarti label kedua HILANG dari tumpukan — paket berangkat tanpa
       * resi, dan tidak ada yang menyadarinya sampai kurir menolak.
       *
       * `tunggal` bernilai benar hanya kalau jumlah halaman toko itu
       * persis sama dengan jumlah labelnya.
       */
      const kertasBerlipat = bulat(kx) && bulat(ky) && tunggal === true;

      if (kertasBerlipat && u.r === 0) {
        const emb = await keluar.embedPage(h, {
          left: 0, bottom: asli.height - th, right: tw, top: asli.height,
        });
        const hal = keluar.addPage([tw, th]);
        hal.drawPage(emb, { x: 0, y: 0 });
        disesuaikan++;
        continue;
      }

      // Halaman menyimpang ditempel ke halaman berukuran sasaran, diperkecil
      // sesuai proporsi dan diletakkan di tengah — tidak ada yang terpotong.
      const emb = await keluar.embedPage(h);
      const hal = keluar.addPage([tw, th]);
      const skala = Math.min(tw / u.w, th / u.t);

      if (u.r === 90 || u.r === 270) {
        const lebar = asli.width * skala, tinggi = asli.height * skala;
        hal.drawPage(emb, {
          xScale: skala, yScale: skala, rotate: degrees(u.r === 90 ? 90 : 270),
          x: u.r === 90 ? (tw + tinggi) / 2 : (tw - tinggi) / 2,
          y: u.r === 90 ? (th - lebar) / 2 : (th + lebar) / 2,
        });
      } else {
        hal.drawPage(emb, {
          xScale: skala, yScale: skala,
          x: (tw - asli.width * skala) / 2,
          y: (th - asli.height * skala) / 2,
        });
      }
      disesuaikan++;
    } catch (e) {
      // Kalau penyesuaian gagal, halaman aslinya TETAP ikut — lebih baik
      // tercetak dengan ukuran menyimpang daripada hilang sama sekali.
      try {
        const [salin] = await keluar.copyPages(src, [src.getPages().indexOf(h)]);
        keluar.addPage(salin);
      } catch { gagal.push(`Halaman gagal disalin: ${e.message}`); }
    }
  }

  if (!keluar.getPageCount()) throw new Error(gagal[0] || 'Tidak ada halaman label yang bisa digabung');
  return {
    buf: Buffer.from(await keluar.save()),
    halaman: keluar.getPageCount(),
    disesuaikan,
    disusunUlang,
    gagal,
  };
}

/**
 * Cetak untuk BEBERAPA toko sekaligus, hasilnya SATU PDF.
 * Tiap toko dipanggil bergiliran, lalu semua halamannya disatukan.
 */
export async function cetakLabelBanyak(rows) {
  // Urutan yang diminta layar, lintas toko. Dipakai untuk menyusun ulang
  // halaman PDF di akhir — lihat catatan di gabungPdf.
  const urutanDiminta = rows.map((r) => r.order_sn);
  const perToko = new Map();
  for (const r of rows) {
    const k = String(r.shop_id);
    if (!perToko.has(k)) perToko.set(k, { nama: r.shop_name || `Toko ${r.shop_id}`, sns: [] });
    perToko.get(k).sns.push(r.order_sn);
  }

  const berkas = [];
  const catatan = [];
  const dicetak = [];   // order_sn yang labelnya benar-benar jadi
  let total = 0, dilewati = 0;

  /**
   * Toko dikerjakan BERSAMAAN, bukan bergiliran.
   *
   * Batas laju Shopee dihitung per toko, jadi menunggu toko A selesai
   * sebelum menyentuh toko B tidak melindungi apa pun — hanya menjumlahkan
   * waktunya. Di dalam satu toko urutannya tetap berurutan dengan jeda,
   * karena di situlah batas lajunya berlaku.
   *
   * Urutan berkas dijaga tetap seperti urutan toko supaya susunan halaman
   * PDF-nya tidak berubah-ubah tiap kali dicetak.
   */
  const daftarToko = [...perToko.entries()];
  const perTokoHasil = await Promise.all(daftarToko.map(async ([shopId, { nama, sns }]) => {
    try {
      const h = await cetakLabel(shopId, sns);
      return { ok: true, nama, sns, h };
    } catch (e) {
      return { ok: false, nama, sns, error: e.message };
    }
  }));

  for (const r of perTokoHasil) {
    if (r.ok) {
      berkas.push({ nama: `Resi-${r.nama.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`, isi: r.h.buf,
                    sns: r.h.dicetak || [] });
      total += r.h.jumlah;
      dilewati += r.h.dilewati;
      dicetak.push(...(r.h.dicetak || []));
      if (r.h.gagal?.length) catatan.push(`${r.nama}: ${r.h.gagal[0]}`);
    } else {
      catatan.push(`${r.nama}: ${r.error}`);
      dilewati += r.sns.length;
    }
  }

  if (!berkas.length) {
    throw new Error(catatan[0] || 'Tidak ada label yang berhasil dibuat');
  }

  const hasil = await gabungPdf(berkas, urutanDiminta);
  const buf = Buffer.isBuffer(hasil) ? hasil : hasil.buf;
  if (hasil?.gagal?.length) catatan.push(...hasil.gagal);
  if (hasil && hasil.disusunUlang === false && berkas.length > 1) {
    catatan.push('Urutan halaman mengikuti kelompok toko, bukan urutan di layar — '
      + 'ada label yang jumlah halamannya tidak satu per pesanan.');
  }
  if (hasil?.disesuaikan > 0) {
    catatan.push(`${hasil.disesuaikan} label berukuran halaman berbeda `
      + '(biasanya Instant/Sameday) disesuaikan ke ukuran yang sama dengan label lain.');
  }

  return {
    buf, total, dilewati, catatan, dicetak,
    toko: berkas.length,
    halaman: hasil?.halaman ?? null,
  };
}
