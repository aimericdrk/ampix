import { authStore } from '../../features/auth/store';
import { getRuntimeConfig } from '../config';
import { ApiError, problemFromResponse } from './problem';
import type { AuthSuccess } from './types';

export interface ApiFetchOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** JSON-serializable request body. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** Auth endpoints are never themselves refresh-retried. */
// /auth/logout is deliberately absent: a stale-token logout should still refresh-and-replay
// so the revocation call reaches the server and the httpOnly refresh cookie gets cleared.
// /auth/2fa/verify is included: it authenticates with a short-lived mfa_token, not an access
// token, so a 401 there means a bad/expired code — refresh-and-replay would be meaningless
// (there is no session yet to refresh).
const AUTH_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/signup',
  '/api/v1/auth/refresh',
  '/api/v1/auth/2fa/verify',
]);

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${getRuntimeConfig().apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthSuccess;
    authStore.setSession(body.access_token, body.user);
    return true;
  } catch {
    return false;
  }
}

/** Single-flight silent refresh: concurrent callers share one /auth/refresh round-trip. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Page-load session restore from the httpOnly refresh cookie. */
export async function restoreSession(): Promise<boolean> {
  const refreshed = await refreshSession();
  if (!refreshed) authStore.clearSession();
  return refreshed;
}

function send(path: string, options: ApiFetchOptions): Promise<Response> {
  const { body, headers, ...init } = options;
  const token = authStore.getState().accessToken;
  return fetch(`${getRuntimeConfig().apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(await problemFromResponse(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Typed transport for every API call:
 * runtime base URL + credentials + bearer injection + RFC 7807 errors +
 * 401 silent-refresh-and-replay (exactly one replay; auth endpoints excluded).
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      authStore.clearSession();
      throw new ApiError(await problemFromResponse(res));
    }
    const replay = await send(path, options);
    // A 401 on the freshly-refreshed token means the session is truly dead
    // (e.g. user disabled); log out locally instead of looping refresh-replay.
    if (replay.status === 401) authStore.clearSession();
    return parse<T>(replay);
  }
  return parse<T>(res);
}
