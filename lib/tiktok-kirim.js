import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { q, one, log } from './db';
import { panggil, tokenHidupTiktok } from './tiktok';

/**
 * ── Atur kirim & cetak resi TikTok ──
 *
 * DASAR BUKTI (uji /api/tiktok/uji-endpoint, 30 Sep 2026, Humaira):
 *   - GET /fulfillment/202309/packages/{id}/shipping_documents
 *       ?document_type=SHIPPING_LABEL — jalur & parameter BENAR. Ditolak
 *       21042104 sebelum diatur kirim ("check shipping is arranged") dan
 *       21042102 sesudah dijemput. Jadi label hanya ada di antara keduanya.
 *   - GET /fulfillment/202309/packages/{id}/handover_time_slots — JALAN:
 *       { can_pickup, can_drop_off, drop_off_point_url,
 *         pickup_slots: [{ avaliable, start_time, end_time }] }
 *       (ejaan "avaliable" memang dari TikTok).
 *   - GET /order/202309/orders?ids= — JALAN, memuat packages[].id.
 *
 * YANG BELUM DIBUKTIKAN dengan panggilan sungguhan: Ship Package
 *   POST /fulfillment/202309/packages/{id}/ship
 *   body { handover_method: 'PICKUP'|'DROP_OFF', pickup_slot: {start_time, end_time} }
 * Jalurnya tercantum di daftar dokumentasi resmi TikTok Partner Center, dan
 * bentuk body-nya sama dengan SDK ecomphp/tiktokshop-php (Fulfillment::
 * shipPackage). Karena tindakan ini TIDAK BISA DIBATALKAN dan belum pernah
 * dipanggil, ada MODE PERDANA: sampai satu Atur kirim berhasil tercatat,
 * tombolnya hanya mau memproses SATU pesanan sekali jalan. Setelah terbukti,
 * batas naik ke BATAS_SEKALI.
 */

export const BATAS_SEKALI = 50;
const PENANDA_TERBUKTI = 'tiktok_kirim_terbukti';

/** Id pesanan TikTok di view adalah NEGATIF order_id. Dibaca sebagai teks. */
export const idKeOrder = (id) => String(id).replace(/^-/, '');

export async function sudahTerbukti() {
  const r = await one(`SELECT last_run FROM jadwal WHERE nama = $1`, [PENANDA_TERBUKTI]).catch(() => null);
  return !!r?.last_run;
}

async function tandaiTerbukti(orderId) {
  await q(`INSERT INTO jadwal (nama, last_run, last_note) VALUES ($1, now(), $2)
           ON CONFLICT (nama) DO UPDATE SET last_run = COALESCE(jadwal.last_run, now()),
             last_note = COALESCE(jadwal.last_note, EXCLUDED.last_note)`,
    [PENANDA_TERBUKTI, `Atur kirim TikTok pertama berhasil: pesanan ${orderId}`]);
}

async function ambilPesanan(orderIds) {
  return q(`
    SELECT o.order_id, o.shop_id, o.status, o.paket_id, o.tracking_number,
           o.shipping_provider, o.atur_kirim_at, o.cetak_count, t.shop_name
      FROM tiktok_orders o LEFT JOIN tiktok_shops t ON t.shop_id = o.shop_id
     WHERE o.order_id = ANY($1::text[])
     ORDER BY o.create_time`, [orderIds]);
}

/**
 * Segarkan satu pesanan dari TikTok (Get Order Detail — terbukti) dan simpan
 * status, resi, dan nomor paketnya. Dipakai sebelum dan sesudah atur kirim.
 */
async function segarkanPesanan(tok, orderId) {
  const json = await panggil('/order/202309/orders', {
    method: 'GET', token: tok.access_token, shopCipher: tok.shop_cipher,
    params: { ids: orderId },
  });
  const o = json.data?.orders?.[0];
  if (!o) return null;
  const paket = (Array.isArray(o.packages) && o.packages[0]?.id)
    || (o.line_items || []).find((x) => x.package_id)?.package_id || null;
  await q(`
    UPDATE tiktok_orders SET status = COALESCE($2, status),
           tracking_number = COALESCE($3, tracking_number),
           shipping_provider = COALESCE($4, shipping_provider),
           paket_id = COALESCE($5, paket_id), update_time = COALESCE($6, update_time),
           fetched_at = now()
     WHERE order_id = $1`,
    [orderId, o.status || null, o.tracking_number || null, o.shipping_provider || null,
     paket, o.update_time ? new Date(Number(o.update_time) * 1000) : null]);
  return { status: o.status, paket, tracking: o.tracking_number || null };
}

/**
 * Pratinjau atur kirim: pastikan tiap pesanan masih AWAITING_SHIPMENT dan
 * punya nomor paket, lalu tanyakan pilihan serah terima ke TikTok.
 * Hanya MEMBACA — tidak mengubah apa pun di TikTok.
 */
export async function pratinjauKirim(ids) {
  const orderIds = [...new Set(ids.map(idKeOrder))];
  const rows = await ambilPesanan(orderIds);
  const terbukti = await sudahTerbukti();
  const perToko = new Map();
  for (const r of rows) {
    if (!perToko.has(r.shop_id)) perToko.set(r.shop_id, []);
    perToko.get(r.shop_id).push(r);
  }

  const siap = [], dilewati = [], pilihan = [];
  for (const [shopId, daftar] of perToko) {
    const tok = await tokenHidupTiktok(shopId);
    let contoh = null;
    for (const r of daftar) {
      let status = r.status, paket = r.paket_id;
      try {
        const s = await segarkanPesanan(tok, r.order_id);
        if (s) { status = s.status; paket = s.paket || paket; }
      } catch (e) {
        dilewati.push({ order_sn: r.order_id, toko: r.shop_name, alasan: `Gagal membaca pesanan: ${e.message}` });
        continue;
      }
      if (status !== 'AWAITING_SHIPMENT') {
        dilewati.push({ order_sn: r.order_id, toko: r.shop_name,
          alasan: `Status di TikTok ${status} — hanya AWAITING_SHIPMENT yang bisa diatur kirim` });
        continue;
      }
      if (!paket) {
        dilewati.push({ order_sn: r.order_id, toko: r.shop_name, alasan: 'TikTok tidak memberi nomor paket' });
        continue;
      }
      siap.push({ order_sn: r.order_id, paket, toko: r.shop_name, shop_id: shopId });
      if (!contoh) contoh = paket;
    }
    if (contoh) {
      try {
        const js = await panggil(`/fulfillment/202309/packages/${contoh}/handover_time_slots`, {
          method: 'GET', token: tok.access_token, shopCipher: tok.shop_cipher,
        });
        const d = js.data || {};
        pilihan.push({
          shop_id: shopId, toko: daftar[0]?.shop_name,
          bisaJemput: !!d.can_pickup, bisaAntar: !!d.can_drop_off,
          titikAntar: d.drop_off_point_url || null,
          slot: (d.pickup_slots || [])
            .filter((x) => x.avaliable !== false && x.available !== false)
            .map((x) => ({ mulai: Number(x.start_time), selesai: Number(x.end_time) })),
        });
      } catch (e) {
        pilihan.push({ shop_id: shopId, toko: daftar[0]?.shop_name, galat: e.message, slot: [] });
      }
    }
  }
  const batas = terbukti ? BATAS_SEKALI : 1;
  return { siap, dilewati, pilihan, terbukti, batas };
}

/**
 * Jalankan atur kirim. TIDAK BISA DIBATALKAN.
 * `pilihan` per toko: { [shop_id]: { metode: 'PICKUP'|'DROP_OFF', mulai, selesai } }
 */
export async function jalankanKirim(ids, pilihan, oleh = null) {
  const pra = await pratinjauKirim(ids);   // cek ulang tepat sebelum menembak
  if (pra.siap.length > pra.batas) {
    throw new Error(pra.terbukti
      ? `Maksimal ${pra.batas} pesanan sekali atur kirim`
      : 'Atur kirim TikTok belum pernah dipakai — pertama kali hanya boleh SATU pesanan, '
        + 'supaya kalau ada yang salah, dampaknya satu paket saja.');
  }
  const hasil = { selesai: [], gagal: [...pra.dilewati] };
  const token = new Map();
  for (const s of pra.siap) {
    const p = pilihan?.[s.shop_id];
    if (!p?.metode) { hasil.gagal.push({ ...s, alasan: 'Cara serah terima belum dipilih' }); continue; }
    const tawaran = pra.pilihan.find((x) => x.shop_id === s.shop_id);
    const body = { handover_method: p.metode };
    if (p.metode === 'PICKUP') {
      if (!tawaran?.bisaJemput) { hasil.gagal.push({ ...s, alasan: 'TikTok tidak menawarkan penjemputan' }); continue; }
      const ada = tawaran.slot.find((x) => x.mulai === Number(p.mulai) && x.selesai === Number(p.selesai));
      if (!ada) { hasil.gagal.push({ ...s, alasan: 'Jadwal jemput yang dipilih sudah tidak ditawarkan' }); continue; }
      body.pickup_slot = { start_time: ada.mulai, end_time: ada.selesai };
    } else if (p.metode === 'DROP_OFF') {
      if (!tawaran?.bisaAntar) { hasil.gagal.push({ ...s, alasan: 'TikTok tidak menawarkan antar sendiri' }); continue; }
    } else {
      hasil.gagal.push({ ...s, alasan: 'Cara serah terima tidak dikenal' }); continue;
    }

    if (!token.has(s.shop_id)) token.set(s.shop_id, await tokenHidupTiktok(s.shop_id));
    const tok = token.get(s.shop_id);
    try {
      await panggil(`/fulfillment/202309/packages/${s.paket}/ship`, {
        method: 'POST', token: tok.access_token, shopCipher: tok.shop_cipher, body,
      });
      await q(`UPDATE tiktok_orders SET atur_kirim_at = now(), atur_kirim_metode = $2
                WHERE order_id = $1`, [s.order_sn, p.metode]);
      await tandaiTerbukti(s.order_sn);
      await segarkanPesanan(tok, s.order_sn).catch(() => null);
      hasil.selesai.push(s);
      await log('tiktok', `Atur kirim ${s.order_sn} (${p.metode})${oleh ? ` oleh ${oleh}` : ''}`);
    } catch (e) {
      hasil.gagal.push({ ...s, alasan: `${e.message}${e.kode ? ` (kode ${e.kode})` : ''}` });
      await log('tiktok', `Atur kirim ${s.order_sn} GAGAL: ${e.message}`, { ok: false });
    }
  }
  return hasil;
}

/** Cari URL dokumen di balasan tanpa menebak satu nama field saja. */
function cariUrl(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.doc_url === 'string') return data.doc_url;
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

/**
 * ── SKU di resi TikTok ──
 *
 * Label dari TikTok tidak memuat SKU, padahal tim gudang mengemas dengan
 * membaca SKU di resi (seperti resi Shopee). Jadi NSC menambahkannya sendiri:
 * halaman label pertama diperkecil sedikit secara PROPORSIONAL (barcode tetap
 * utuh, hanya ±10% lebih kecil) dan pita di bawahnya diisi daftar
 * "SKU × jumlah". Tidak ada yang ditimpa — isi label asli tetap lengkap.
 */
const TINGGI_PITA = 0.11;   // porsi tinggi halaman untuk pita SKU

/** Font standar PDF hanya mengenal Latin-1; huruf lain diganti '?'. */
const latin = (t) => String(t || '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function bungkusBaris(teks, font, ukuran, lebar) {
  const kata = teks.split(' ');
  const baris = [];
  let kini = '';
  for (const k of kata) {
    const coba = kini ? `${kini} ${k}` : k;
    if (font.widthOfTextAtSize(coba, ukuran) <= lebar) { kini = coba; continue; }
    if (kini) baris.push(kini);
    kini = k;
  }
  if (kini) baris.push(kini);
  return baris;
}

async function tempelSku(gabung, pdf, barang, font) {
  const asli = pdf.getPage(0);
  const { width: L, height: T } = asli.getSize();
  const pita = Math.max(26, T * TINGGI_PITA);
  const skala = (T - pita) / T;
  const tertanam = await gabung.embedPage(asli);
  const hal = gabung.addPage([L, T]);
  hal.drawPage(tertanam, {
    x: (L - L * skala) / 2, y: pita, xScale: skala, yScale: skala,
  });
  hal.drawLine({ start: { x: 6, y: pita - 2 }, end: { x: L - 6, y: pita - 2 },
    thickness: 0.6, color: rgb(0, 0, 0) });
  const teks = latin(barang.map((b) => `${b.sku} x${b.qty}`).join('  |  ')) || '(SKU kosong)';
  let ukuran = 9;
  let baris = bungkusBaris(teks, font, ukuran, L - 14);
  while (baris.length * (ukuran + 1.5) > pita - 6 && ukuran > 5.5) {
    ukuran -= 0.5;
    baris = bungkusBaris(teks, font, ukuran, L - 14);
  }
  const muat = Math.max(1, Math.floor((pita - 6) / (ukuran + 1.5)));
  if (baris.length > muat) {
    baris = baris.slice(0, muat);
    baris[muat - 1] = `${baris[muat - 1].slice(0, Math.max(0, baris[muat - 1].length - 6))} ...`;
  }
  baris.forEach((b, i) => {
    hal.drawText(b, { x: 7, y: pita - 4 - (i + 1) * (ukuran + 1.5) + 1.5, size: ukuran, font,
      color: rgb(0, 0, 0) });
  });
  // Halaman label berikutnya (kalau ada) disalin apa adanya.
  if (pdf.getPageCount() > 1) {
    const sisa = await gabung.copyPages(pdf, pdf.getPageIndices().slice(1));
    sisa.forEach((h) => gabung.addPage(h));
  }
}

/**
 * SKU per pesanan untuk pita resi: SKU penjual + NAMA SKU dari TikTok
 * (sku_name — nama variasi yang tampil di aplikasi pembeli), keduanya dari
 * line_items pesanan. Nama "Default" dibuang karena itu bawaan TikTok untuk
 * produk tanpa variasi.
 */
async function barangPesanan(orderId) {
  return q(`
    SELECT CONCAT_WS(' - ',
             COALESCE(NULLIF(TRIM(seller_sku), ''), CASE WHEN sku_name IS NULL THEN product_name END),
             NULLIF(NULLIF(TRIM(sku_name), ''), 'Default')) AS sku,
           COUNT(*)::int AS qty
      FROM tiktok_order_items WHERE order_id = $1
     GROUP BY 1 ORDER BY MIN(line_item_id)`, [orderId]);
}

/**
 * Jenis dokumen label. Bawaan SHIPPING_LABEL + pita SKU buatan NSC.
 * Kalau uji /api/tiktok/uji-endpoint membuktikan SHIPPING_LABEL_AND_PACKING_SLIP
 * sudah memuat nama SKU dari TikTok dan muat di kertas, pilih lewat env
 * TIKTOK_JENIS_LABEL=SHIPPING_LABEL_AND_PACKING_SLIP — pita NSC lalu tidak
 * ditempel lagi, dokumen TikTok dicetak apa adanya.
 */
/**
 * BAWAAN DIUBAH 4 Okt 2026: SHIPPING_LABEL_AND_PACKING_SLIP.
 * Prima mau resi SAMA PERSIS seperti TikTok tapi dengan SKU. Label polos
 * (SHIPPING_LABEL) terbukti hanya memuat "Barang : Default". Dokumen yang
 * memuat daftar produk/SKU dari TikTok sendiri adalah label + daftar kemas
 * (packing slip) — nilai ini tercantum di dokumentasi Get Package Shipping
 * Document. Kalau TikTok menolak nilai itu untuk paket tertentu, cetak
 * OTOMATIS jatuh kembali ke SHIPPING_LABEL supaya resi tetap keluar.
 * Paksa label polos lewat env TIKTOK_JENIS_LABEL=SHIPPING_LABEL.
 */
const JENIS_LABEL = process.env.TIKTOK_JENIS_LABEL === 'SHIPPING_LABEL'
  ? 'SHIPPING_LABEL' : 'SHIPPING_LABEL_AND_PACKING_SLIP';

/**
 * Cetak resi TikTok: ambil label tiap paket, gabung jadi satu PDF mengikuti
 * urutan yang diminta. Satu pesanan gagal tidak membatalkan yang lain.
 */
export async function cetakLabelTiktok(ids) {
  const orderIds = [...new Set(ids.map(idKeOrder))];
  const rows = await ambilPesanan(orderIds);
  const urut = new Map(orderIds.map((x, i) => [x, i]));
  rows.sort((a, b) => urut.get(a.order_id) - urut.get(b.order_id));

  const gabung = await PDFDocument.create();
  const font = await gabung.embedFont(StandardFonts.HelveticaBold);
  const catatanJenis = new Set();
  const berhasil = [], gagal = [];
  const token = new Map();
  for (const r of rows) {
    try {
      if (!token.has(r.shop_id)) token.set(r.shop_id, await tokenHidupTiktok(r.shop_id));
      const tok = token.get(r.shop_id);
      let paket = r.paket_id;
      if (!paket) paket = (await segarkanPesanan(tok, r.order_id))?.paket;
      if (!paket) throw new Error('nomor paket belum ada');
      const ambil = (jenis) => panggil(`/fulfillment/202309/packages/${paket}/shipping_documents`, {
        method: 'GET', token: tok.access_token, shopCipher: tok.shop_cipher,
        params: { document_type: jenis },
      });
      let js;
      try {
        js = await ambil(JENIS_LABEL);
      } catch (e) {
        // Penolakan bisnis (belum diatur kirim / sudah dijemput) berlaku untuk
        // semua jenis dokumen — tidak ada gunanya dicoba ulang.
        if (JENIS_LABEL === 'SHIPPING_LABEL' || /21042104|21042102/.test(e.message)) throw e;
        js = await ambil('SHIPPING_LABEL');
        catatanJenis.add(`label + daftar kemas ditolak TikTok (${e.message.slice(0, 120)}), `
          + 'dicetak label polos');
      }
      const url = cariUrl(js.data);
      if (!url) throw new Error(`TikTok tidak memberi tautan label (field: ${Object.keys(js.data || {}).join(', ') || 'kosong'})`);
      if (js.data?.tracking_number) {
        await q(`UPDATE tiktok_orders SET tracking_number = COALESCE(tracking_number, $2)
                  WHERE order_id = $1`, [r.order_id, js.data.tracking_number]);
      }
      const unduh = await fetch(url);
      if (!unduh.ok) throw new Error(`gagal mengunduh label (HTTP ${unduh.status})`);
      const byte = new Uint8Array(await unduh.arrayBuffer());
      const pdf = await PDFDocument.load(byte);
      const sebelum = gabung.getPageCount();
      try {
        /**
         * KEPUTUSAN PRIMA 4 Okt 2026: resi TikTok dicetak SAMA PERSIS seperti
         * dari TikTok — NSC tidak menambahkan apa pun. Pita SKU hanya aktif
         * kalau env TIKTOK_PITA_SKU=1 sengaja dinyalakan.
         */
        if (process.env.TIKTOK_PITA_SKU !== '1' || JENIS_LABEL !== 'SHIPPING_LABEL') {
          throw new Error('dokumen TikTok dipakai apa adanya');
        }
        await tempelSku(gabung, pdf, await barangPesanan(r.order_id), font);
      } catch {
        while (gabung.getPageCount() > sebelum) gabung.removePage(gabung.getPageCount() - 1);
        // Kalau penempelan SKU gagal, label asli tetap harus keluar utuh.
        const hal = await gabung.copyPages(pdf, pdf.getPageIndices());
        hal.forEach((h) => gabung.addPage(h));
      }
      berhasil.push(r.order_id);
    } catch (e) {
      const pesan = /21042104/.test(e.message)
        ? 'pengirimannya belum diatur — tekan Atur kirim dulu'
        : /21042102/.test(e.message) ? 'paket sudah dijemput, label tidak bisa dicetak lagi' : e.message;
      gagal.push({ order_sn: r.order_id, alasan: pesan });
    }
  }
  return {
    pdf: berhasil.length ? await gabung.save() : null,
    berhasil, gagal, toko: new Set(rows.map((r) => r.shop_id)).size,
    // Catatan jatuh-kembali (bukan kegagalan) — ikut tampil di catatan resi.
    info: [...catatanJenis],
  };
}
