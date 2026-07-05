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
 * Runtime base URL + credentials + bearer injection + 401 silent-refresh-and-replay (exactly one
 * replay; auth endpoints excluded). Returns the raw `Response` so both JSON and binary (blob)
 * callers share the identical transport + refresh semantics.
 */
async function sendWithRefresh(path: string, options: ApiFetchOptions): Promise<Response> {
  const res = await send(path, options);
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      authStore.clearSession();
      return res;
    }
    const replay = await send(path, options);
    // A 401 on the freshly-refreshed token means the session is truly dead
    // (e.g. user disabled); log out locally instead of looping refresh-replay.
    if (replay.status === 401) authStore.clearSession();
    return replay;
  }
  return res;
}

/**
 * Typed transport for every JSON API call:
 * runtime base URL + credentials + bearer injection + RFC 7807 errors +
 * 401 silent-refresh-and-replay (exactly one replay; auth endpoints excluded).
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return parse<T>(await sendWithRefresh(path, options));
}

/**
 * Binary variant of {@link apiFetch} for authed, membership-gated asset GETs (e.g. §18 screen
 * images): a bare `<img src>` can't carry the bearer token, so we fetch the bytes through the same
 * authed transport and hand back a `Blob` the caller turns into an object URL. RFC 7807 errors and
 * the single 401 refresh-replay behave exactly as the JSON path.
 */
export async function apiFetchBlob(path: string, options: ApiFetchOptions = {}): Promise<Blob> {
  const res = await sendWithRefresh(path, options);
  if (!res.ok) throw new ApiError(await problemFromResponse(res));
  return res.blob();
}
