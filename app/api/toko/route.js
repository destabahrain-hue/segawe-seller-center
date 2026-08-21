import { NextResponse } from 'next/server';
import { q, one, log } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { aksi, shop_id } = await req.json();
  if (!shop_id) return NextResponse.json({ ok: false, error: 'shop_id kosong' }, { status: 400 });

  try {
    const toko = await one('SELECT shop_id, shop_name FROM shops WHERE shop_id = $1', [shop_id]);
    if (!toko) return NextResponse.json({ ok: false, error: 'Toko tidak ditemukan' }, { status: 404 });
    const nama = toko.shop_name || `Toko ${shop_id}`;

    // Putuskan: token dibuang, SEMUA data penjualan tetap disimpan.
    if (aksi === 'putuskan') {
      await q(
        `UPDATE shops SET access_token = NULL, refresh_token = NULL, expires_at = NULL,
                          status = 'terputus', last_error = NULL
         WHERE shop_id = $1`, [shop_id]);
      await log('toko', `${nama} diputuskan — data penjualan tetap disimpan`, { shopId: shop_id });
      return NextResponse.json({ ok: true, pesan: 'Toko diputuskan. Data penjualan tetap tersimpan.' });
    }

    // Hapus permanen: baris toko dihapus, seluruh data ikut terhapus lewat ON DELETE CASCADE.
    if (aksi === 'hapus') {
      const n = await one(
        `SELECT (SELECT COUNT(*) FROM orders WHERE shop_id = $1) AS pesanan,
                (SELECT COUNT(*) FROM products WHERE shop_id = $1) AS produk`, [shop_id]);
      await q('DELETE FROM shops WHERE shop_id = $1', [shop_id]);
      await log('toko', `${nama} DIHAPUS permanen beserta ${n.pesanan} pesanan`, { ok: false });
      return NextResponse.json({ ok: true, pesan: `${nama} dihapus beserta ${n.pesanan} pesanan.` });
    }

    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
