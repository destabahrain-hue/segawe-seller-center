import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { cetakLabelBanyak, periksaPilihan } from '@/lib/label';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Balasannya SATU PDF, walau pesanannya dari beberapa toko sekaligus.
 * Kalau gagal, balasannya JSON — sisi browser membedakannya dari Content-Type
 * supaya pesan Shopee tetap terbaca, bukan jadi berkas rusak.
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const { ids } = await req.json();
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada pesanan dipilih' }, { status: 400 });
    }

    const { rows } = await periksaPilihan(ids);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'Pesanan tidak ditemukan' }, { status: 404 });
    }

    const hasil = await cetakLabelBanyak(rows);
    const cap = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
      .replace(/[-: ]/g, '').slice(0, 14);

    return new Response(hasil.buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Resi-${hasil.total}-label-${cap}.pdf"`,
        'X-Jumlah-Label': String(hasil.total),
        'X-Jumlah-Toko': String(hasil.toko),
        'X-Dilewati': String(hasil.dilewati),
        'X-Catatan': encodeURIComponent(hasil.catatan.join(' | ').slice(0, 400)),
        // Nomor pesanan yang labelnya BENAR-BENAR jadi. Dipakai layar untuk
        // menandai "sudah dicetak" setelah operator memastikan kertasnya keluar.
        'X-Order-Sn': encodeURIComponent((hasil.dicetak || []).join(',').slice(0, 3000)),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
