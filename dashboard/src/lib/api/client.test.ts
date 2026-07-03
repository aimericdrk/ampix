import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import {
  authState,
  REFRESHED_ACCESS_TOKEN,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../test/msw/handlers';
import { apiFetch, restoreSession } from './client';
import { ApiError } from './problem';
import type { ListProjectsResponse } from './types';

describe('apiFetch', () => {
  it('injects the Authorization header from the auth store', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    const result = await apiFetch<ListProjectsResponse>('/api/v1/projects');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe('Demo App');
  });

  it('throws ApiError with the parsed problem on non-2xx auth-endpoint responses', async () => {
    await expect(
      apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'wrong' },
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      problem: { status: 401, title: 'Invalid email or password' },
    });
  });

  it('silently refreshes and replays the original request on 401', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = true;

    const result = await apiFetch<ListProjectsResponse>('/api/v1/projects');

    expect(result.projects).toHaveLength(1);
    expect(authState.refreshCalls).toBe(1);
    expect(authStore.getState().accessToken).toBe(REFRESHED_ACCESS_TOKEN);
  });

  it('single-flights concurrent refreshes', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = true;

    const [a, b] = await Promise.all([
      apiFetch<ListProjectsResponse>('/api/v1/projects'),
      apiFetch<ListProjectsResponse>('/api/v1/projects'),
    ]);

    expect(a.projects).toHaveLength(1);
    expect(b.projects).toHaveLength(1);
    expect(authState.refreshCalls).toBe(1);
  });

  it('clears the session and throws when the refresh itself fails', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = false;

    await expect(apiFetch('/api/v1/projects')).rejects.toBeInstanceOf(ApiError);
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });

  it('returns undefined for 204 responses', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    await expect(apiFetch<void>('/api/v1/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('restoreSession', () => {
  it('authenticates from the refresh cookie on page load', async () => {
    authState.refreshValid = true;
    await expect(restoreSession()).resolves.toBe(true);
    expect(authStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: REFRESHED_ACCESS_TOKEN,
      user: TEST_USER,
    });
  });

  it('marks the visitor anonymous when no valid refresh cookie exists', async () => {
    authState.refreshValid = false;
    await expect(restoreSession()).resolves.toBe(false);
    expect(authStore.getState().status).toBe('anonymous');
  });
});
