import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tokoAktif, tokenHidup } from '@/lib/tokens';
import { call, tidur } from '@/lib/shopee';
import { EP } from '@/lib/endpoints';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Seberapa jauh ke belakang get_order_list masih memulangkan pesanan?
 *
 * Shopee membatasi akses data pesanan lama, tapi batasnya tidak pernah
 * dinyatakan terang di dokumentasi. Daripada menebak (dan membuat tombol
 * "tarik riwayat" menjanjikan data yang tidak akan pernah datang), rute ini
 * mencobanya langsung dengan token toko asli: satu jendela 7 hari pada
 * beberapa jarak mundur, lalu melaporkan apa adanya.
 */
export async function GET(req) {
  await ensureSchema();
  const url = new URL(req.url);
  const toko = await tokoAktif();
  const t = url.searchParams.get('shop_id')
    ? toko.find((x) => String(x.shop_id) === url.searchParams.get('shop_id'))
    : toko[0];
  if (!t) return NextResponse.json({ ok: false, error: 'Tidak ada toko aktif' }, { status: 400 });

  const token = await tokenHidup(t.shop_id);
  const mundur = (url.searchParams.get('hari') || '30,90,180,270,365')
    .split(',').map((x) => Number(x.trim())).filter(Boolean);

  const hasil = [];
  for (const hari of mundur) {
    const sampai = Math.floor(Date.now() / 1000) - hari * 86400;
    const dari = sampai - 7 * 86400;
    const jendela = { dari: new Date(dari * 1000).toISOString().slice(0, 10),
                      sampai: new Date(sampai * 1000).toISOString().slice(0, 10) };
    try {
      const json = await call(EP.orderList, {
        accessToken: token, shopId: t.shop_id,
        params: { time_range_field: 'create_time', time_from: dari, time_to: sampai,
                  page_size: 20, response_optional_fields: 'order_status' },
      });
      const daftar = json.response?.order_list || [];
      hasil.push({ hari, jendela, ok: true, pesanan: daftar.length,
                   more: !!json.response?.more, contoh: daftar[0]?.order_sn || null });
    } catch (e) {
      hasil.push({ hari, jendela, ok: false, galat: e.message, kode: e.kind || null });
    }
    await tidur(400);
  }

  return NextResponse.json({
    ok: true, toko: t.shop_name || String(t.shop_id),
    catatan: 'pesanan 0 TANPA galat berarti Shopee menerima permintaannya tapi tidak memulangkan apa pun '
           + '— entah memang tidak ada pesanan di jendela itu, atau data lama tidak lagi dibuka. '
           + 'Bandingkan dengan jendela yang lebih baru sebelum menyimpulkan.',
    hasil,
  });
}
