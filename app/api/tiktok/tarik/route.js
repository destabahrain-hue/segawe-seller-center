import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { antrikanTarikTiktok, statusTarikTiktok, ringkasTiktok } from '@/lib/tiktok-sync';
import { jalankanAntrean } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req) {
  await ensureSchema();
  const shopId = new URL(req.url).searchParams.get('shop_id');
  return NextResponse.json({ ok: true, ...(await ringkasTiktok()),
    status: shopId ? await statusTarikTiktok(shopId) : null });
}

/**
 * Mengantrikan penarikan, BUKAN mengerjakannya di sini.
 *
 * Versi sebelumnya menarik langsung di dalam permintaan ini, dan itu salah:
 * 90 hari butuh ratusan panggilan, gateway memutus di tengah, lalu tim
 * harus menekan tombol berulang kali sambil menebak sudah sampai mana.
 * Sekarang satu tekan memecah pekerjaan jadi tugas jendela 7 hari yang
 * diselesaikan penjadwal di latar belakang.
 */
export async function POST(req) {
  if (!sesi()) return NextResponse.json({ ok: false, error: 'Belum masuk' }, { status: 401 });
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  if (!b.shop_id) return NextResponse.json({ ok: false, error: 'shop_id kosong' }, { status: 400 });

  try {
    const antre = await antrikanTarikTiktok(b.shop_id,
      { hari: b.hari, bagian: b.bagian || 'semua' });
    // Satu tugas dijalankan tanpa ditunggu, supaya bilahnya langsung bergerak.
    jalankanAntrean({ maks: 1, budgetMs: 20000 }).catch(() => {});
    return NextResponse.json({ ok: true, antre,
      status: await statusTarikTiktok(b.shop_id), ringkas: await ringkasTiktok() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, kode: e.kode || null }, { status: 500 });
  }
}
