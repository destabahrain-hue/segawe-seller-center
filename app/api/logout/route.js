import { NextResponse } from 'next/server';
export async function POST(req) {
  const res = NextResponse.redirect(new URL('/login', process.env.APP_URL || req.url));
  res.cookies.set('nsc_session', '', { path: '/', maxAge: 0 });
  return res;
}
