// app/api/tiktok/hubungkan/route.js
//
// Melempar peramban ke halaman otorisasi TikTok Shop, meniru pola
// /api/auth/shopee. Tujuannya diambil dari linkOtorisasi() di lib/tiktok.js:
// TIKTOK_AUTH_LINK (tempelan utuh dari Partner Center) atau TIKTOK_SERVICE_ID.
//
// Kalau dua-duanya belum diisi, pengguna dikembalikan ke /tiktok dengan
// penjelasan — lewat pengalihan RELATIF, bukan dari req.url. Di belakang
// proxy Railway, req.url terbaca localhost:8080, jadi membangun URL absolut
// darinya melempar orang ke localhost (pelajaran yang sama dengan rute login).

import { NextResponse } from 'next/server';
import { linkOtorisasi } from '@/lib/tiktok';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tujuan = linkOtorisasi();
  if (tujuan) return NextResponse.redirect(tujuan);
  return new NextResponse(null, {
    status: 303,
    headers: { Location: '/tiktok?hubungkan=belum' },
  });
}
