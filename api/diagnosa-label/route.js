import { NextResponse } from 'next/server';
import { ensureSchema, one, q } from '@/lib/db';
import { call, tidur } from '@/lib/shopee';
import { EP, JEDA_MS } from '@/lib/endpoints';
import { tokenHidup } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Alat diagnosa cetak resi.
 *
 * Menebak-nebak sudah gagal berkali-kali. Alat ini memanggil Shopee dengan
 * beberapa kombinasi berbeda untuk SATU pesanan, lalu melaporkan mana yang
 * diterima dan apa persisnya balasan Shopee. Tidak mengubah apa pun selain
 * membuat dokumen — yang memang boleh diulang.
 *
 * Dua mode:
 *   ?order_sn=XXX  — bedah satu pesanan, coba semua kombinasi
 *   (tanpa param)  — SURVEI: coba beberapa pesanan dengan tracking_status
 *                    berbeda, lalu laporkan status mana yang labelnya bisa
 *                    dibuat. Ini yang menjawab "kapan resi jadi sah",
 *                    tanpa perlu menebak.
 */
const ringkas = (x) => {
  try { return JSON.parse(JSON.stringify(x)); } catch { return String(x); }
};

async function coba(nama, fn) {
  try {
    const hasil = await fn();
    return { nama, ok: true, balasan: ringkas(hasil?.response ?? hasil) };
  } catch (e) {
    return {
      nama, ok: false,
      pesan: e.message,
      kode: e.shopeeCode || null,
      detail: ringkas(e.respons) || null,
    };
  } finally {
    await tidur(JEDA_MS);
  }
}

/** Survei: satu percobaan create untuk tiap pesanan, dikelompokkan per status. */
async function survei(batas = 10) {
  const rows = await q(`
    SELECT DISTINCT ON (COALESCE(o.tracking_status,'(kosong)'), o.shop_id)
           o.order_sn, o.shop_id, o.status, o.tracking_status, o.tracking_no,
           o.package_number, o.ship_by_date, o.carrier, s.shop_name
    FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id
    WHERE NULLIF(TRIM(COALESCE(o.tracking_no,'')),'') IS NOT NULL
      AND o.status IN ('PROCESSED','READY_TO_SHIP','SHIPPED','TO_CONFIRM_RECEIVE')
    ORDER BY COALESCE(o.tracking_status,'(kosong)'), o.shop_id, o.created_time DESC
    LIMIT $1`, [batas]);

  const hasil = [];
  for (const o of rows) {
    let token;
    try { token = await tokenHidup(o.shop_id); }
    catch (e) { hasil.push({ ...ringkasPesanan(o), hasil: 'token gagal', sebab: e.message }); continue; }

    const baris = { order_sn: o.order_sn };
    if (o.package_number) baris.package_number = o.package_number;
    const c = await coba('create', () =>
      call(EP.docBuat, { accessToken: token, shopId: o.shop_id, body: { order_list: [baris] } }));

    hasil.push({
      ...ringkasPesanan(o),
      hasil: c.ok ? 'BISA DICETAK' : 'ditolak',
      sebab: c.ok ? null : (c.detail?.result_list?.[0]?.fail_error || c.kode || c.pesan),
    });
  }
  return hasil;
}

const ringkasPesanan = (o) => ({
  order_sn: o.order_sn, toko: o.shop_name || String(o.shop_id),
  status: o.status, tracking_status: o.tracking_status || '(kosong)',
  kurir: o.carrier, ada_paket: !!o.package_number,
});

export async function GET(req) {
  try {
    await ensureSchema();
    const sn = new URL(req.url).searchParams.get('order_sn');

    if (!sn) {
      const daftar = await survei();
      const bisa = daftar.filter((x) => x.hasil === 'BISA DICETAK');
      return NextResponse.json({
        ok: true,
        catatan: 'Survei: satu percobaan cetak untuk tiap kombinasi status. '
               + 'Lihat tracking_status mana yang BISA DICETAK.',
        status_yang_bisa: [...new Set(bisa.map((x) => x.tracking_status))],
        status_yang_ditolak: [...new Set(daftar.filter((x) => x.hasil !== 'BISA DICETAK')
          .map((x) => `${x.tracking_status} → ${x.sebab}`))],
        daftar,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const o = await one(
      `SELECT o.*, s.shop_name FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id
       WHERE o.order_sn = $1 LIMIT 1`, [sn]);
    if (!o) return NextResponse.json({ ok: false, error: `Pesanan ${sn} tidak ada di database` }, { status: 404 });

    const shopId = o.shop_id;
    const token = await tokenHidup(shopId);
    const langkah = [];

    // 1. Apa kata Shopee tentang pesanan ini
    langkah.push(await coba('get_tracking_number', () =>
      call(EP.trackingNumber, { accessToken: token, shopId, params: { order_sn: sn } })));

    langkah.push(await coba('get_shipping_document_parameter (tanpa package_number)', () =>
      call(EP.docParam, { accessToken: token, shopId, body: { order_list: [{ order_sn: sn }] } })));

    if (o.package_number) {
      langkah.push(await coba('get_shipping_document_parameter (dengan package_number)', () =>
        call(EP.docParam, {
          accessToken: token, shopId,
          body: { order_list: [{ order_sn: sn, package_number: o.package_number }] },
        })));
    }

    // 2. Coba buat dokumen dengan beberapa kombinasi
    const jenisUji = [null, 'THERMAL_AIR_WAYBILL', 'NORMAL_AIR_WAYBILL'];
    for (const jenis of jenisUji) {
      for (const pakaiPaket of (o.package_number ? [false, true] : [false])) {
        const baris = { order_sn: sn };
        if (jenis) baris.shipping_document_type = jenis;
        if (pakaiPaket) baris.package_number = o.package_number;
        langkah.push(await coba(
          `create_shipping_document [${jenis || 'tanpa jenis'}]${pakaiPaket ? ' + package_number' : ''}`,
          () => call(EP.docBuat, { accessToken: token, shopId, body: { order_list: [baris] } })));
      }
    }

    // ── Jalur alternatif yang belum pernah diuji ──

    // a) kirim tracking_number secara eksplisit — kode errornya menyebut
    //    nomor resi padahal kita tidak pernah mengirimnya; layak dicoba.
    if (o.tracking_no) {
      langkah.push(await coba('create_shipping_document + tracking_number eksplisit', () =>
        call(EP.docBuat, {
          accessToken: token, shopId,
          body: { order_list: [{
            order_sn: sn,
            tracking_number: o.tracking_no,
            ...(o.package_number ? { package_number: o.package_number } : {}),
            shipping_document_type: 'THERMAL_AIR_WAYBILL',
          }] },
        })));
    }

    // b) jalur "job" — versi massal/asinkron
    langkah.push(await coba('create_shipping_document_job', () =>
      call(EP.docJobBuat, {
        accessToken: token, shopId,
        body: { order_list: [{
          order_sn: sn,
          ...(o.package_number ? { package_number: o.package_number } : {}),
          shipping_document_type: 'THERMAL_AIR_WAYBILL',
        }] },
      })));

    // b2) JALUR UNDUH PRODUKSI — yang sebenarnya menghasilkan PDF.
    //     Selama ini tidak pernah diuji di sini, padahal "dokumen berhasil
    //     dibuat" belum berarti "PDF-nya bisa diambil".
    langkah.push(await coba('download_shipping_document (jalur produksi)', async () => {
      const { callBiner } = await import('@/lib/shopee');
      const baris = { order_sn: sn, shipping_document_type: 'THERMAL_AIR_WAYBILL' };
      if (o.package_number) baris.package_number = o.package_number;
      if (o.tracking_no) baris.tracking_number = o.tracking_no;
      const { buf } = await callBiner(EP.docUnduh, {
        accessToken: token, shopId, body: { order_list: [baris] },
      });
      return { response: { bytesPdf: buf?.length || 0,
                           awalanBerkas: Buffer.from(buf.slice(0, 5)).toString('latin1') } };
    }));

    // c) jalur ringkas satu langkah
    langkah.push(await coba('download_to_label', () =>
      call(EP.docKeLabel, {
        accessToken: token, shopId,
        body: { order_list: [{
          order_sn: sn,
          ...(o.package_number ? { package_number: o.package_number } : {}),
        }] },
      })));

    const berhasil = langkah
      .filter((x) => x.ok && /create|download_to_label/.test(String(x.nama)))
      .map((x) => x.nama);

    return NextResponse.json({
      ok: true,
      pesanan: {
        order_sn: o.order_sn, toko: o.shop_name || String(o.shop_id), status: o.status,
        kurir: o.carrier, resi_tersimpan: o.tracking_no, package_number: o.package_number,
        batas_kirim: o.ship_by_date, tracking_status: o.tracking_status,
      },
      kombinasi_yang_diterima: berhasil.length ? berhasil : '(tidak ada)',
      langkah,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
