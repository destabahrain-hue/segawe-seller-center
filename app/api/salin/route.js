import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { antrikan } from '@/lib/queue';
import { jalankanAntrean } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Penyalinan TIDAK dijalankan langsung. Tiap produk masuk antrean,
 * dikerjakan bertahap dengan jeda. Kamu boleh menutup halaman —
 * progresnya dilihat di halaman Antrean Tugas.
 */
export async function POST(req) {
  const { dari, ke, items } = await req.json();
  if (!dari || !ke) return NextResponse.json({ ok: false, error: 'Toko sumber atau tujuan kosong' }, { status: 400 });
  if (String(dari) === String(ke)) return NextResponse.json({ ok: false, error: 'Toko sumber dan tujuan sama' }, { status: 400 });
  if (!Array.isArray(items) || !items.length) {
    return NextResponse.json({ ok: false, error: 'Tidak ada produk dipilih' }, { status: 400 });
  }

  try {
    await ensureSchema();
    for (const itemId of items) {
      await antrikan('salin_produk', { shopId: ke, payload: { dari, item_id: itemId } });
    }
    // Kerjakan sebentar supaya kamu langsung melihat hasil pertama —
    // sisanya diteruskan cron.
    const hasil = await jalankanAntrean({ maks: 2, budgetMs: 25000 });
    return NextResponse.json({ ok: true, diantrikan: items.length, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
