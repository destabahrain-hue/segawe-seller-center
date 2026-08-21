import { cookies } from 'next/headers';

export const COOKIE = 'nsc_session';

export function sessionValue() {
  return process.env.APP_SESSION_TOKEN || 'dev-token';
}

export function isLoggedIn() {
  return cookies().get(COOKIE)?.value === sessionValue();
}
