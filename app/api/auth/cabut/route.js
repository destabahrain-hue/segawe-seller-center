import { NextResponse } from 'next/server';
import { cancelAuthUrl } from '@/lib/shopee';
export const dynamic = 'force-dynamic';

/** Antar seller ke halaman Shopee untuk mencabut izin aplikasi. */
export async function GET() {
  return NextResponse.redirect(cancelAuthUrl());
}
