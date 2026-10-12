import { NextResponse } from 'next/server';
import { ensureSchema, q, log } from '@/lib/db';
import { sesi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Sisihkan / kembalikan pesanan.
 *
 * Menyisihkan TIDAK menyentuh Shopee sama sekali — ini murni penanda di
 * sisi kita supaya pesanan tidak ikut terproses. Batas kirimnya tetap
 * berjalan, dan itu memang harus tetap terlihat: menyisihkan bukan
 * membatalkan, dan barang yang ditahan terlalu lama tetap kena penalti.
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const b = await req.json();
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada pesanan dipilih' }, { status: 400 });
    }
    const s = sesi();
    const oleh = s?.nama || 'tidak diketahui';

    if (b.kembalikan) {
      const r = await q(
        `UPDATE orders SET disisihkan_at = NULL, disisihkan_oleh = NULL, disisihkan_alasan = NULL
          WHERE id = ANY($1::bigint[]) AND disisihkan_at IS NOT NULL
          RETURNING order_sn`, [ids]);
      await log('pesanan', `${r.length} pesanan dikembalikan dari disisihkan oleh ${oleh}`);
      return NextResponse.json({ ok: true, jumlah: r.length, kembalikan: true });
    }

    // Pesanan yang pengirimannya sudah diatur tidak boleh disisihkan:
    // resinya sudah terbit dan kurir sudah dijadwalkan. Menahannya di sini
    // hanya menyembunyikannya dari layar tanpa menghentikan apa pun.
    const r = await q(
      `UPDATE orders
          SET disisihkan_at = now(), disisihkan_oleh = $2,
              disisihkan_alasan = NULLIF(TRIM($3), '')
        WHERE id = ANY($1::bigint[])
          AND ship_arranged_at IS NULL
          AND disisihkan_at IS NULL
        RETURNING order_sn`, [ids, oleh, String(b.alasan || '').slice(0, 300)]);

    await log('pesanan',
      `${r.length} pesanan disisihkan oleh ${oleh}`
      + (b.alasan ? ` — ${String(b.alasan).slice(0, 100)}` : ''));

    return NextResponse.json({
      ok: true, jumlah: r.length,
      dilewati: ids.length - r.length,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
