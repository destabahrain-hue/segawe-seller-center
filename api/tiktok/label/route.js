import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { cetakLabelTiktok } from '@/lib/tiktok-kirim';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cetak resi TikTok. Bentuk balasannya SAMA dengan /api/label (Shopee):
 * PDF kalau ada label yang jadi, JSON kalau tidak ada sama sekali — supaya
 * layar Pesanan memakai alur yang sama (jendela tunggu, penanda sudah
 * dicetak, penjaga resi kembar).
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const { ids } = await req.json();
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada pesanan dipilih' }, { status: 400 });
    }
    if (ids.some((x) => !String(x).startsWith('-'))) {
      return NextResponse.json({ ok: false,
        error: 'Pilihan berisi pesanan Shopee — pisahkan dulu lewat saklar Marketplace' }, { status: 400 });
    }
    const h = await cetakLabelTiktok(ids);
    if (!h.pdf) {
      return NextResponse.json({ ok: false,
        error: 'Tidak ada label yang bisa dicetak: '
          + h.gagal.map((g) => `${g.order_sn} — ${g.alasan}`).join(' | ').slice(0, 900) }, { status: 422 });
    }
    const cap = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
      .replace(/[-: ]/g, '').slice(0, 14);
    return new Response(h.pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Resi-TikTok-${h.berhasil.length}-label-${cap}.pdf"`,
        'X-Jumlah-Label': String(h.berhasil.length),
        'X-Jumlah-Toko': String(h.toko),
        'X-Dilewati': String(h.gagal.length),
        'X-Catatan': encodeURIComponent([...(h.info || []),
          ...h.gagal.map((g) => `${g.order_sn}: ${g.alasan}`)].join(' | ').slice(0, 400)),
        'X-Order-Sn': encodeURIComponent(h.berhasil.join(',').slice(0, 3000)),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
