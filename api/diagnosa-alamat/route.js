import { NextResponse } from 'next/server';
import { ensureSchema, one } from '@/lib/db';
import { tokoAktif, tokenHidup } from '@/lib/tokens';
import { call } from '@/lib/shopee';
import { EP } from '@/lib/endpoints';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Apakah Shopee benar-benar menyensor alamat pembeli untuk app ini?
 *
 * Yang tersimpan di database sudah "****", tapi itu belum membuktikan
 * sumbernya: bisa saja Shopee mengirim aslinya dan kode kita yang salah
 * membaca. Rute ini memanggil get_order_detail untuk SATU pesanan terbaru
 * lalu memulangkan recipient_address apa adanya, plus daftar field yang
 * benar-benar dikirim — jadi jawabannya datang dari Shopee, bukan tebakan.
 *
 * Nilai yang dipulangkan sengaja dipendekkan: yang dicari cuma "tersensor
 * atau tidak", bukan isinya.
 */
const pendek = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (/^\*+$/.test(s)) return `TERSENSOR (${s.length} bintang)`;
  return s.length <= 4 ? s : `${s.slice(0, 4)}… (${s.length} huruf)`;
};

export async function GET(req) {
  await ensureSchema();
  const url = new URL(req.url);
  const toko = await tokoAktif();
  const t = url.searchParams.get('shop_id')
    ? toko.find((x) => String(x.shop_id) === url.searchParams.get('shop_id'))
    : toko[0];
  if (!t) return NextResponse.json({ ok: false, error: 'Tidak ada toko aktif' }, { status: 400 });

  const sn = url.searchParams.get('order_sn') || (await one(
    `SELECT order_sn FROM orders WHERE shop_id = $1 ORDER BY created_time DESC LIMIT 1`, [t.shop_id]))?.order_sn;
  if (!sn) return NextResponse.json({ ok: false, error: 'Tidak ada pesanan tersimpan' }, { status: 400 });

  const token = await tokenHidup(t.shop_id);
  const json = await call(EP.orderDetail, {
    accessToken: token, shopId: t.shop_id,
    params: {
      order_sn_list: sn,
      response_optional_fields: 'recipient_address,buyer_username,buyer_user_id,total_amount,item_list',
    },
  });

  const o = json.response?.order_list?.[0] || {};
  const a = o.recipient_address || {};
  return NextResponse.json({
    ok: true,
    toko: t.shop_name || String(t.shop_id),
    order_sn: sn,
    kunci_pesanan: Object.keys(o),
    kunci_alamat: Object.keys(a),
    alamat: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, pendek(v)])),
    buyer_username: pendek(o.buyer_username),
    catatan: 'TERSENSOR di sini berarti Shopee sendiri yang menyamarkan — app ini terdaftar '
           + 'tanpa akses data sensitif, jadi tidak ada cara membacanya dari kode. Kalau nilainya '
           + 'utuh, berarti masalahnya di penyimpanan kita dan bisa diperbaiki.',
  });
}
