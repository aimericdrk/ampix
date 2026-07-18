import { authStore } from '../../features/auth/store';
import { getRuntimeConfig } from '../config';
import type { ApiFetchOptions } from './client';
import { ApiError, problemFromResponse } from './problem';

/**
 * Typed transport for the `mobile_purchase` (billing-authority) service — the sibling of
 * {@link apiFetch} that every MyRevenueCat data page uses. It prefixes `purchaseApiBaseUrl` (a
 * distinct origin from `apiBaseUrl`; both services expose /api/v1/projects/:projectId/…), forwards
 * the same dashboard bearer JWT from the shared auth store + `Content-Type`, sends credentials, and
 * maps RFC 7807 problem bodies to {@link ApiError} — identical error handling to `apiFetch`.
 *
 * Unlike `apiFetch` it does NOT run the 401 silent-refresh-and-replay: token refresh is owned by
 * the same-origin `apiFetch` path (and `restoreSession` on load); a 401 here surfaces as an
 * `ApiError` the RC pages render as a configuration/auth error slot (design §3 gating).
 */
export async function purchaseApiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, ...init } = options;
  const token = authStore.getState().accessToken;
  const res = await fetch(`${getRuntimeConfig().purchaseApiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new ApiError(await problemFromResponse(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
