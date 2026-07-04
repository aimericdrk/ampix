import type { CookieOptions, Response } from 'express';
import { AuthConfig } from './auth-config.util';

/** §11: httpOnly refresh cookie, scoped to the auth routes only. */
export const REFRESH_COOKIE_NAME = 'mam_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function cookieOptions(auth: AuthConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: auth.cookieSecure,
    domain: auth.cookieDomain,
    path: REFRESH_COOKIE_PATH,
  };
}

/** Sets/rotates the refresh cookie with a fresh max-age on every issue. */
export function setRefreshCookie(res: Response, token: string, auth: AuthConfig): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...cookieOptions(auth),
    maxAge: auth.refreshTokenTtl * 1000,
  });
}

/** Clears the refresh cookie (logout, or a failed /refresh). Options must match `setRefreshCookie`
 *  (path/domain/sameSite) or browsers will not recognize it as the same cookie to delete. */
export function clearRefreshCookie(res: Response, auth: AuthConfig): void {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(auth));
}
