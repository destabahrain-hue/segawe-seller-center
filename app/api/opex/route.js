import { NextResponse } from 'next/server';
import { peranSekarang, bolehUang } from '@/lib/auth';
import {
  simpanOpex, simpanTokoManual, hapusOpex, hapusTokoManual, salinBulanLalu,
} from '@/lib/opex';
import { hapusBonusPeriode } from '@/lib/bonus-iklan';

export const dynamic = 'force-dynamic';

/**
 * Semua yang di sini menyentuh angka uang, jadi dijaga bolehUang().
 *
 * Middleware cuma memeriksa tiket sesinya sah, tidak memeriksa peran —
 * jadi penjagaan peran HARUS dilakukan di sini. Tanpa ini, siapa pun
 * yang bisa login bisa mengubah beban gaji.
 */
async function tolakKalauTakBoleh() {
  if (!bolehUang(await peranSekarang())) {
    return NextResponse.json(
      { ok: false, error: 'Tidak punya akses ke data keuangan' }, { status: 403 });
  }
  return null;
}

export async function POST(req) {
  const tolak = await tolakKalauTakBoleh();
  if (tolak) return tolak;

  const b = await req.json();
  try {
    if (b.aksi === 'salin') {
      const n = await salinBulanLalu(b.bulan);
      return NextResponse.json({ ok: true, disalin: n });
    }
    if (b.aksi === 'hapus-bonus') {
      await hapusBonusPeriode(b.shopId, b.jenis, b.dari, b.sampai);
      return NextResponse.json({ ok: true });
    }
    if (b.aksi === 'toko-manual') {
      await simpanTokoManual(b);
      return NextResponse.json({ ok: true });
    }
    await simpanOpex(b);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const tolak = await tolakKalauTakBoleh();
  if (tolak) return tolak;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const jenis = searchParams.get('jenis');   // 'opex' | 'toko-manual'
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id kosong' }, { status: 400 });
  }
  try {
    if (jenis === 'toko-manual') await hapusTokoManual(id);
    else await hapusOpex(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
