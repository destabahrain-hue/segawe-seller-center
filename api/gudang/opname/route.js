import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi, peranSekarang, bolehRute, bolehKoreksiStok } from '@/lib/auth';
import { mulaiOpname, simpanHitungan, terapkanOpname, batalkanOpname, tambahSku } from '@/lib/opname';

export const dynamic = 'force-dynamic';

/**
 * Semua orang yang boleh membuka Gudang boleh MENGHITUNG. Menerapkan
 * selisih ke stok (dan membatalkan opname) hanya akun master — sama
 * dengan aturan koreksi di formulir mutasi.
 */
export async function POST(req) {
  const peran = await peranSekarang();
  if (!bolehRute(peran, '/gudang')) {
    return NextResponse.json({ ok: false, error: 'Tidak punya akses ke Gudang' }, { status: 403 });
  }
  const s = sesi();
  const oleh = s?.nama || 'tidak diketahui';
  try {
    await ensureSchema();
    const b = await req.json();
    if (b.aksi === 'mulai') return NextResponse.json({ ok: true, opname: await mulaiOpname({ oleh, catatan: b.catatan }) });
    if (b.aksi === 'tambah-sku') return NextResponse.json({ ok: true, ms: await tambahSku(b) });
    if (b.aksi === 'simpan') {
      return NextResponse.json({ ok: true, disimpan: await simpanHitungan(Number(b.id), b.baris || [], oleh) });
    }
    if (b.aksi === 'terapkan' || b.aksi === 'batal') {
      if (!(await bolehKoreksiStok())) {
        return NextResponse.json(
          { ok: false, error: 'Akunmu tidak diizinkan menerapkan atau membatalkan opname' }, { status: 403 });
      }
      const n = b.aksi === 'terapkan' ? await terapkanOpname(Number(b.id), oleh) : await batalkanOpname(Number(b.id), oleh);
      return NextResponse.json({ ok: true, n });
    }
    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
