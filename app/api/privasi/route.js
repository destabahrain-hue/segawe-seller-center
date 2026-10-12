import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { statusPrivasi, isiPembeliId, isiPembeliIdRetur, bersihkanPrivasi } from '@/lib/pembeli';

export const dynamic = 'force-dynamic';

/** Status kepatuhan batas simpan 90 hari — siapa pun yang sudah masuk boleh lihat. */
export async function GET() {
  await ensureSchema();
  return NextResponse.json({ ok: true, ...(await statusPrivasi()) });
}

/**
 * Jalankan manual, tanpa menunggu giliran harian penjadwal. Khusus akun
 * master: pembersihan tidak bisa dibatalkan.
 */
export async function POST(req) {
  if (!sesi()?.master) {
    return NextResponse.json({ ok: false, error: 'Hanya akun master' }, { status: 403 });
  }
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  const sidik = await isiPembeliId({ batas: Number(b.batas) || 20000 });
  await isiPembeliIdRetur({ batas: 5000 });
  if (b.aksi !== 'bersihkan') return NextResponse.json({ ok: true, sidik });
  if (sidik.sisa) {
    return NextResponse.json({ ok: false, sidik,
      error: `Masih ada ${sidik.sisa} pesanan tanpa sidik pembeli — jalankan lagi sampai habis sebelum membersihkan` },
      { status: 409 });
  }
  const bersih = await bersihkanPrivasi({ batas: Number(b.batas) || 20000 });
  return NextResponse.json({ ok: true, sidik, bersih });
}
