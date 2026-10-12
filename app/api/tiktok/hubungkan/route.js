// app/api/tiktok/hubungkan/route.js
//
// Melempar peramban ke halaman otorisasi TikTok Shop, meniru pola
// /api/auth/shopee. Tujuannya diambil dari linkOtorisasi() di lib/tiktok.js:
// TIKTOK_AUTH_LINK (tempelan utuh dari Partner Center) atau TIKTOK_SERVICE_ID.
//
// Kalau dua-duanya belum diisi, pengguna dikembalikan ke /tiktok dengan
// penjelasan, bukan dibiarkan menatap galat.

import { NextResponse } from 'next/server';
import { linkOtorisasi } from '@/lib/tiktok';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const tujuan = linkOtorisasi();
  if (tujuan) return NextResponse.redirect(tujuan);
  return NextResponse.redirect(new URL('/tiktok?hubungkan=belum', req.url));
}
