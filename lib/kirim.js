import { q, log } from './db';
import { call, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { tokenHidup } from './tokens';

/**
 * ── Atur pengiriman (Pack) ──
 *
 * Inilah satu-satunya bagian aplikasi yang TIDAK BISA DIBATALKAN. Begitu
 * ship_order berhasil, pesanan resmi diatur pengirimannya di Shopee dan
 * nomor resinya terbit. Tidak ada tombol urungkan — di Shopee pun tidak.
 *
 * Karena itu ada dua lapis:
 *   1. pratinjau — menunjukkan apa yang AKAN dikirim, tanpa menjalankan
 *   2. jalankan  — baru benar-benar memanggil ship_order
 *
 * Shopee menentukan sendiri apakah pesanan perlu dijemput (pickup) atau
 * diantar ke titik drop-off. Pilihan itu tidak boleh ditebak: dibaca dari
 * get_shipping_parameter, dan kalau bentuknya tidak dikenali, prosesnya
 * dihentikan alih-alih mengarang parameter.
 */

/**
 * Pilih alamat jemput yang BENAR.
 *
 * Shopee mengirim semua alamat terdaftar toko — alamat default, alamat
 * retur, dan alamat jemput — dalam satu daftar. Mengambil yang pertama
 * saja pernah membuat alamat retur terpilih sebagai tempat penjemputan.
 * Penandanya ada di address_flag, dan itulah yang dipakai.
 */
export function pilihAlamat(daftar = []) {
  const punya = (a, tanda) => (a.address_flag || []).some((f) =>
    String(f).toLowerCase().includes(tanda));
  return daftar.find((a) => punya(a, 'pickup'))
      || daftar.find((a) => punya(a, 'default'))
      || daftar[0]
      || null;
}

const teksAlamat = (a) => !a ? '—' :
  [a.address, a.district, a.city, a.state, a.zipcode].filter(Boolean).join(', ');

/**
 * Pecah satu jadwal jemput jadi HARI dan JAM yang terpisah.
 *
 * Kolom `date` dari Shopee bukan tanggal, melainkan waktu lengkap sampai
 * jamnya. Memperlakukannya sebagai tanggal membuat tiap jam dianggap hari
 * berbeda — dan pilihan jamnya lenyap.
 */
const TZ = 'Asia/Jakarta';
function pecahSlot(s) {
  const d = s.date ? new Date(Number(s.date) * 1000) : null;
  const hari = d ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d) : '';
  const hariTeks = d
    ? d.toLocaleDateString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' })
    : 'Tanggal tidak disebutkan';

  // Shopee kadang memberi rentang siap pakai ("13:00 - 15:00"); kalau tidak,
  // jamnya diambil dari `date` itu sendiri.
  const jamTeks = s.time_text || s.pickup_time_text
    || ([s.time_slot_start, s.time_slot_end].filter(Boolean).length
        ? [s.time_slot_start, s.time_slot_end].filter(Boolean)
            .map((t) => new Date(Number(t) * 1000)
              .toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }))
            .join(' – ')
        : (d ? d.toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
             : 'Jam tidak disebutkan'));

  return { id: s.pickup_time_id, hari, hariTeks, jamTeks };
}

/**
 * Alamat yang terdaftar di Seller Centre. Dipakai sebagai rujukan kalau
 * get_shipping_parameter tidak menawarkan alamat sama sekali — supaya
 * kelihatan apakah alamat gudangnya memang belum diatur, atau pesanannya
 * yang memang tidak memakai penjemputan.
 */
export async function alamatToko(token, shopId) {
  try {
    const json = await call(EP.alamatList, { accessToken: token, shopId });
    const d = json.response?.address_list || json.response?.addresses || [];
    return d.map((a) => ({
      id: a.address_id,
      teks: [a.address, a.district, a.city, a.state, a.zipcode].filter(Boolean).join(', '),
      penanda: a.address_flag || [],
    }));
  } catch {
    return [];
  }
}

/** Baca cara kirim yang diminta Shopee untuk satu pesanan. */
export async function parameterKirim(token, shopId, orderSn) {
  const json = await call(EP.kirimParam, {
    accessToken: token, shopId, params: { order_sn: orderSn },
  });
  const r = json.response || {};
  const perlu = r.info_needed || {};
  const bisaPickup = Array.isArray(perlu.pickup);
  const bisaDropoff = Array.isArray(perlu.dropoff);

  const daftarAlamat = r.pickup?.address_list || [];
  const alamat = pilihAlamat(daftarAlamat);
  // Jadwal dikumpulkan per alamat, karena tiap alamat punya jadwalnya sendiri.
  const slotPerAlamat = {};
  for (const a of daftarAlamat) {
    slotPerAlamat[String(a.address_id)] = (a.time_slot_list || []).map(pecahSlot);
  }
  const slot = slotPerAlamat[String(alamat?.address_id)] || [];
  const cabang = (r.dropoff?.branch_list || [])[0] || null;

  return {
    order_sn: orderSn,
    bisaPickup, bisaDropoff,
    alamat: alamat ? {
      id: alamat.address_id,
      teks: teksAlamat(alamat),
      penanda: alamat.address_flag || [],
    } : null,
    alamatLain: daftarAlamat.map((a) => ({
      id: a.address_id, teks: teksAlamat(a), penanda: a.address_flag || [],
    })),
    slotPerAlamat,
    slot,
    dropoff: cabang ? { id: cabang.branch_id, teks: cabang.branch_name || String(cabang.branch_id) } : null,
    // Mode ditentukan Shopee, bukan oleh kita. Kalau ia hanya meminta
    // drop-off, tidak ada alamat maupun jadwal yang perlu dipilih — dan
    // menampilkan formulir jemput yang kosong hanya membingungkan.
    mode: bisaPickup ? 'pickup' : (bisaDropoff ? 'dropoff' : 'tidak dikenali'),
    siap: (bisaPickup && !!alamat?.address_id) || bisaDropoff,
  };
}

/**
 * Pesanan yang ternyata sudah diatur di Shopee: catat resinya kalau ada,
 * tandai sudah diatur, dan bersihkan tanda gagal — supaya ia pindah ke
 * tab Sedang dikemas alih-alih menetap di Pesanan baru.
 */
async function tandaiSudahDiatur(token, shopId, o, sebab) {
  let resi = null;
  try {
    const t = await call(EP.trackingNumber, {
      accessToken: token, shopId, params: { order_sn: o.order_sn },
    });
    resi = t.response?.tracking_number || t.response?.first_mile_tracking_number || null;
  } catch { /* resi menyusul lewat sinkron logistik */ }

  await q(
    `UPDATE orders SET ship_arranged_at = COALESCE(ship_arranged_at, now()),
            tracking_no = COALESCE($3, tracking_no),
            pack_gagal_at = NULL, pack_gagal_jenis = NULL,
            pack_gagal_kode = NULL, pack_gagal_pesan = NULL
      WHERE shop_id = $1 AND order_sn = $2`, [shopId, o.order_sn, resi]);
  await log('kirim', `Pesanan ${o.order_sn} ${sebab}` + (resi ? `, resi ${resi}` : ''), { shopId });

  return { order_sn: o.order_sn, ok: true, resi, catatan: sebab };
}

/**
 * Jalankan pengaturan pengiriman untuk satu pesanan.
 * `pilihan` datang dari layar Pack — tanggal, jam jemput, atau drop-off —
 * jadi aplikasi tidak pernah menentukannya sendiri.
 */
async function aturSatu(token, shopId, o, pilihan) {
  const dasar = { order_sn: o.order_sn };

  if (pilihan?.mode === 'dropoff') {
    dasar.dropoff = pilihan.branch_id ? { branch_id: pilihan.branch_id } : {};
  } else {
    if (!pilihan?.address_id) {
      return { order_sn: o.order_sn, ok: false, error: 'Alamat jemput belum dipilih' };
    }
    dasar.pickup = { address_id: pilihan.address_id };
    if (pilihan.pickup_time_id) dasar.pickup.pickup_time_id = pilihan.pickup_time_id;
  }

  /**
   * package_number TIDAK dikirim pada percobaan pertama.
   *
   * Untuk pesanan yang tidak dipecah jadi beberapa paket — dan itu
   * mayoritas — Shopee menolak mentah-mentah:
   *   logistics.ship_order_not_need_pacakge_number
   *   "Please don't request with package_number for this unsplit order."
   *
   * Nomor paketnya tetap disimpan karena CETAK RESI justru membutuhkannya:
   * tanpa itu create_shipping_document membalas "The tracking number is
   * invalid" yang menyesatkan. Jadi nomor itu benar untuk resi, racun
   * untuk ship_order.
   *
   * Kalau ternyata pesanannya memang terpecah dan Shopee meminta nomornya,
   * dicoba SEKALI lagi dengan nomor itu. Mengulang setelah panggilan yang
   * DITOLAK aman — yang ditolak tidak mengubah apa pun di Shopee.
   */
  const kirimKe = (pakaiPaket) => call(EP.kirimAtur, {
    accessToken: token, shopId,
    body: pakaiPaket ? { ...dasar, package_number: o.package_number } : dasar,
  });

  // Sengaja hanya nama parameternya, termasuk salah ketik milik Shopee
  // sendiri ("pacakge_number"). Mencocokkan kata "package" saja terlalu
  // longgar: penolakan lain berbunyi "...when package is ready to be
  // shipped" dan akan memicu percobaan ulang yang sia-sia.
  const soalPaket = (e) => /pacakge_number|package_number/i
    .test(`${e.shopeeCode || ''} ${e.message || ''}`);

  /**
   * "not eligible for rescheduling" bukan kegagalan, melainkan kabar bahwa
   * permintaan logistiknya SUDAH ada di Shopee. Menandainya gagal akan
   * melempar pesanan ke tab Proses gagal dan membuatnya dicoba berulang
   * tanpa pernah bisa maju. Yang benar: akui saja sudah diatur.
   */
  const sudahDiatur = (e) => /not eligible for rescheduling|already.*(shipped|arranged)/i
    .test(`${e.shopeeCode || ''} ${e.message || ''}`);

  try {
    await kirimKe(false);
  } catch (e) {
    if (sudahDiatur(e)) return await tandaiSudahDiatur(token, shopId, o, 'sudah diatur di Shopee');
    if (!o.package_number || !soalPaket(e)) {
      return { order_sn: o.order_sn, ok: false, asli: e,
               error: `${e.shopeeCode || ''} ${e.message}`.trim() };
    }
    try {
      await kirimKe(true);
    } catch (e2) {
      if (sudahDiatur(e2)) return await tandaiSudahDiatur(token, shopId, o, 'sudah diatur di Shopee');
      return { order_sn: o.order_sn, ok: false, asli: e2,
               error: `${e2.shopeeCode || ''} ${e2.message}`.trim() };
    }
  }

  await tidur(JEDA_MS);
  let resi = null;
  try {
    const t = await call(EP.trackingNumber, {
      accessToken: token, shopId, params: { order_sn: o.order_sn },
    });
    resi = t.response?.tracking_number || t.response?.first_mile_tracking_number || null;
  } catch { /* resi menyusul */ }

  await q(
    `UPDATE orders SET ship_arranged_at = now(), tracking_no = COALESCE($3, tracking_no),
            pack_gagal_at = NULL, pack_gagal_jenis = NULL,
            pack_gagal_kode = NULL, pack_gagal_pesan = NULL
     WHERE shop_id = $1 AND order_sn = $2`, [shopId, o.order_sn, resi]);
  await log('kirim', `Pesanan ${o.order_sn} diatur pengirimannya`
    + (resi ? `, resi ${resi}` : ', resi menyusul'), { shopId });

  return { order_sn: o.order_sn, ok: true, resi };
}

/**
 * Kumpulkan parameter kirim — SATU panggilan per (toko × kurir), bukan per
 * pesanan.
 *
 * Alamat jemput milik toko dan jadwalnya ditentukan kurir, jadi seratus
 * pesanan SPX Hemat dari toko yang sama menghasilkan jawaban yang sama
 * persis. Menanyakannya seratus kali hanya menghabiskan waktu — dan itulah
 * yang dulu memaksa batas 30 pesanan.
 *
 * Perbedaan per pesanan tetap mungkin, dan itu ditangani saat eksekusi:
 * tiap pesanan yang ditolak Shopee dilaporkan sendiri.
 */
export async function pratinjauPack(rows) {
  const grup = new Map();
  for (const r of rows) {
    const kunci = `${r.shop_id}|${r.carrier || 'Tanpa kurir'}`;
    if (!grup.has(kunci)) grup.set(kunci, { shopId: r.shop_id, kurir: r.carrier || 'Tanpa kurir',
                                            toko: r.shop_name, pesanan: [] });
    grup.get(kunci).pesanan.push(r);
  }

  const hasil = [];
  const alamatCache = new Map();
  for (const [, g] of grup) {
    let token;
    try { token = await tokenHidup(g.shopId); }
    catch (e) {
      hasil.push({ kunci: `${g.toko} · ${g.kurir}`, toko: g.toko, kurir: g.kurir,
                   jumlah: g.pesanan.length, orderSns: g.pesanan.map((o) => o.order_sn),
                   siap: false, error: e.message });
      continue;
    }

    if (!alamatCache.has(String(g.shopId))) {
      alamatCache.set(String(g.shopId), await alamatToko(token, g.shopId));
    }

    try {
      const p = await parameterKirim(token, g.shopId, g.pesanan[0].order_sn);
      hasil.push({
        ...p,
        kunci: `${g.toko} · ${g.kurir}`,
        toko: g.toko, kurir: g.kurir,
        jumlah: g.pesanan.length,
        orderSns: g.pesanan.map((o) => o.order_sn),
        alamatTerdaftar: alamatCache.get(String(g.shopId)),
      });
    } catch (e) {
      hasil.push({ kunci: `${g.toko} · ${g.kurir}`, toko: g.toko, kurir: g.kurir,
                   jumlah: g.pesanan.length, orderSns: g.pesanan.map((o) => o.order_sn),
                   siap: false, error: `${e.shopeeCode || ''} ${e.message}`.trim() });
    }
    await tidur(JEDA_MS);
  }
  return hasil;
}

/** Satu pesanan, dipanggil dari antrean. */
export async function packSatu(shopId, orderSn, pilihan) {
  const token = await tokenHidup(shopId);
  const o = { order_sn: orderSn, package_number: pilihan?.package_number || null };
  const hasil = await aturSatu(token, shopId, o, pilihan);
  if (!hasil.ok) {
    // Kode galat Shopee HARUS ikut terbawa. Tanpa itu antrean menyangka
    // penolakan bisnis sebagai gangguan jaringan, lalu mengulangnya empat
    // kali — persis kelakuan yang sedang diperbaiki.
    const e = new Error(hasil.error || 'Gagal mengatur pengiriman');
    if (hasil.asli) { e.shopeeCode = hasil.asli.shopeeCode; e.kind = hasil.asli.kind; }
    throw e;
  }
  return hasil;
}

/** Jalankan Pack memakai pilihan dari layar. */
export async function jalankanPack(rows, pilihanPerPesanan) {
  const hasil = [];
  const perToko = new Map();
  for (const r of rows) {
    const k = String(r.shop_id);
    if (!perToko.has(k)) perToko.set(k, { nama: r.shop_name || `Toko ${r.shop_id}`, pesanan: [] });
    perToko.get(k).pesanan.push(r);
  }
  for (const [shopId, { nama, pesanan }] of perToko) {
    let token;
    try { token = await tokenHidup(shopId); }
    catch (e) {
      for (const o of pesanan) hasil.push({ toko: nama, order_sn: o.order_sn, ok: false, error: e.message });
      continue;
    }
    for (const o of pesanan) {
      const pil = pilihanPerPesanan[o.order_sn];
      if (!pil) { hasil.push({ toko: nama, order_sn: o.order_sn, ok: false, error: 'Tidak ada pilihan kirim' }); continue; }
      hasil.push({ toko: nama, ...(await aturSatu(token, shopId, o, pil)) });
      await tidur(JEDA_MS);
    }
  }
  return hasil;
}
