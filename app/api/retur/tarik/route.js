import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sapuReturSemua } from '@/lib/retur';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Tarik retur: seluruh halaman, semua toko, sekali jalan.
 *
 * Dulu sengaja dipotong beberapa bagian per panggilan karena penarikan
 * memakai rentang waktu dan riwayatnya panjang. Saringan waktu itu ternyata
 * tidak pernah bekerja (lihat kepala lib/retur.js), dan paginasi polos jauh
 * lebih murah: 50 retur per panggilan, dan sebagian besar toko habis dalam
 * satu sampai dua halaman. Jadi tidak ada lagi yang perlu dilanjutkan.
 *
 * maxDuration dinaikkan karena kini delapan toko diselesaikan sekaligus.
 */
export async function POST() {
  try {
    await ensureSchema();
    const hasil = await sapuReturSemua();
    return NextResponse.json({
      ok: true,
      tersimpan: hasil.reduce((a, x) => a + (x.tersimpan || 0), 0),
      toko: hasil,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
