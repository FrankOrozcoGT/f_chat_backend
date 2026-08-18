import type { CookieOptions } from 'express';

export const AUTH_TOKEN_COOKIE = 'auth_token';

export function buildAuthCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
