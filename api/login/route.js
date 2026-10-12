import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { masuk, buatTiket, rutePertama, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Pengalihan RELATIF ("/pesanan", bukan "https://domain/pesanan").
 *
 * Dulu tujuan dibangun dari APP_URL, jadi siapa pun yang login lewat
 * domain kustom dilempar ke domain Railway — tempat cookie sesinya tidak
 * berlaku — lalu ditendang lagi ke halaman login. Alamat relatif selalu
 * kembali ke domain yang sedang dibuka, berapa pun domainnya, tanpa perlu
 * mempercayai header Host. (APP_URL tetap dipakai untuk callback Shopee &
 * TikTok, karena alamat itu yang terdaftar di sana.)
 */
function pindah(tujuan) {
  return new NextResponse(null, { status: 303, headers: { Location: tujuan } });
}

export async function POST(req) {
  try {
    await ensureSchema();
    const form = await req.formData();
    const pengguna = await masuk(form.get('username'), String(form.get('password') || ''));
    if (!pengguna) return pindah('/login?salah=1');

    const res = pindah(rutePertama(pengguna.peran));
    res.cookies.set(COOKIE, buatTiket(pengguna), {
      httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return pindah('/login?galat=' + encodeURIComponent(e.message));
  }
}
