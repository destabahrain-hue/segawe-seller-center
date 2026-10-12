import { NextResponse } from 'next/server';

/** Pengalihan relatif — tetap di domain yang sedang dibuka (lihat api/login). */
export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  res.cookies.set('nsc_session', '', { path: '/', maxAge: 0 });
  return res;
}
