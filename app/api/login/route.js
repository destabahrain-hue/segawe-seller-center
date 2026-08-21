import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { masuk, buatTiket, rutePertama, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const base = process.env.APP_URL || req.url;
  try {
    await ensureSchema();
    const form = await req.formData();
    const pengguna = await masuk(form.get('username'), String(form.get('password') || ''));
    if (!pengguna) return NextResponse.redirect(new URL('/login?salah=1', base));

    const res = NextResponse.redirect(new URL(rutePertama(pengguna.peran), base));
    res.cookies.set(COOKIE, buatTiket(pengguna), {
      httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL('/login?galat=' + encodeURIComponent(e.message), base));
  }
}
