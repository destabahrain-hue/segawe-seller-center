import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tarikIklanItemSemua } from '@/lib/iklan-item';

export const dynamic = 'force-dynamic';
// Jauh lebih lama daripada /api/iklan: batas laju endpoint Ads memaksa jeda
// 1,5 detik, dan iklan otomatis harus dipanggil sehari sekali per toko.
// Perkiraan kasar: (7 + jumlah hari) panggilan per toko.
export const maxDuration = 300;

export async function POST(req) {
  try {
    await ensureSchema();
    const { hari = 7 } = await req.json().catch(() => ({}));
    // Dibatasi 30 hari sekali jalan. Untuk rentang lebih panjang, jalankan
    // berulang — sekali jalan 90 hari akan menabrak batas waktu maupun
    // batas laju, dan gagal di tengah lebih buruk daripada bertahap.
    const n = Math.min(Math.max(Number(hari) || 7, 1), 30);
    const hasil = await tarikIklanItemSemua({ hariKeBelakang: n });
    return NextResponse.json({ ok: true, hari: n, hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
