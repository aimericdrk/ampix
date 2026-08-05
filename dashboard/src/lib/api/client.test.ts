import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../../features/auth/store';
import {
  authState,
  REFRESHED_ACCESS_TOKEN,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
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

  it('clears the session when the replayed request is rejected again', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = true;
    // The API rejects every token — e.g. the user was disabled between refresh and replay.
    server.use(
      http.get('/api/v1/projects', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Access token invalid or expired', status: 401 },
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    await expect(apiFetch('/api/v1/projects')).rejects.toMatchObject({
      name: 'ApiError',
      problem: { status: 401 },
    });
    expect(authState.refreshCalls).toBe(1);
    expect(authStore.getState()).toEqual({
      accessToken: null,
      user: null,
      status: 'anonymous',
    });
  });

  it('clears the session and throws when the refresh itself fails', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = false;

    await expect(apiFetch('/api/v1/projects')).rejects.toBeInstanceOf(ApiError);
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });

  describe('in dev mode', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('keeps the session when the refresh fails', async () => {
      // DEV is already true under Vitest; MODE is what distinguishes dev from test.
      vi.stubEnv('MODE', 'development');
      authStore.setSession('expired-access-token', TEST_USER);
      authState.refreshValid = false;

      await expect(apiFetch('/api/v1/projects')).rejects.toBeInstanceOf(ApiError);
      expect(authStore.getState().status).toBe('authenticated');
      expect(authStore.getState().accessToken).toBe('expired-access-token');
    });
  });

  it('returns undefined for 204 responses', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    await expect(
      apiFetch<void>('/api/v1/auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined();
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
