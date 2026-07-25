import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/problem';
import { server } from '../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { authStore } from '../auth/store';
import { useRcApps, type RcApp } from './catalog-api';
import {
  storeCredentialStatusKey,
  useDisconnectStoreCredentials,
  useSetStoreCredentials,
  useStoreCredentialStatus,
  type GooglePlayCredentialInput,
  type StoreCredentialStatusDto,
} from './store-credentials-api';

const PID = TEST_PROJECT.id;
const APP_ID = 'app-1';
const APPS = `/api/v1/projects/${PID}/catalog/apps`;
const BASE = `${APPS}/${APP_ID}/store-credentials`;

const APP: RcApp = {
  id: APP_ID,
  name: 'Demo Android',
  platform: 'ANDROID',
  bundleId: null,
  packageName: 'com.demo.app',
  publicSdkKey: 'mp_pub_abc123',
  storeConnected: false,
};

const STATUS: StoreCredentialStatusDto = {
  connected: true,
  platform: 'ANDROID',
  liveVerified: false,
  verifiedAt: null,
};

const GOOGLE_INPUT: GooglePlayCredentialInput = {
  kind: 'google_play',
  serviceAccountJson: '{"type":"service_account","client_email":"x@y.iam","private_key":"k","project_id":"p"}',
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('storeCredentialStatusKey', () => {
  it('is keyed by project, appId and the status tag', () => {
    expect(storeCredentialStatusKey(PID, APP_ID)).toEqual([
      'rc-store-credentials',
      PID,
      APP_ID,
      'status',
    ]);
  });
});

describe('useStoreCredentialStatus', () => {
  it('GETs the per-app status path and returns the parsed status', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`${BASE}/status`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(STATUS);
      }),
    );

    const { result } = renderHook(() => useStoreCredentialStatus(PID, APP_ID), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/status`);
    expect(result.current.data).toEqual(STATUS);
  });
});

describe('useSetStoreCredentials', () => {
  it('PUTs the blob to the store-credentials path and invalidates the apps list + status query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenMethod = '';
    let seenBody: unknown;
    let appsCalls = 0;
    let statusCalls = 0;
    server.use(
      http.get(APPS, () => {
        appsCalls += 1;
        return HttpResponse.json([APP]);
      }),
      http.get(`${BASE}/status`, () => {
        statusCalls += 1;
        return HttpResponse.json(STATUS);
      }),
      http.put(BASE, async ({ request }) => {
        seenUrl = request.url;
        seenMethod = request.method;
        seenBody = await request.json();
        return HttpResponse.json(STATUS);
      }),
    );

    const Wrapper = wrapper();
    const apps = renderHook(() => useRcApps(PID), { wrapper: Wrapper });
    const status = renderHook(() => useStoreCredentialStatus(PID, APP_ID), { wrapper: Wrapper });
    await waitFor(() => expect(apps.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(appsCalls).toBe(1);
    expect(statusCalls).toBe(1);

    const set = renderHook(() => useSetStoreCredentials(PID, APP_ID), { wrapper: Wrapper });
    act(() => {
      set.result.current.mutate(GOOGLE_INPUT);
    });

    await waitFor(() => expect(set.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}`);
    expect(seenMethod).toBe('PUT');
    expect(seenBody).toEqual(GOOGLE_INPUT);
    expect(set.result.current.data).toEqual(STATUS);
    await waitFor(() => expect(appsCalls).toBe(2));
    await waitFor(() => expect(statusCalls).toBe(2));
  });

  it('surfaces a 422 problem body as ApiError with field errors and does not invalidate the status query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let statusCalls = 0;
    server.use(
      http.get(`${BASE}/status`, () => {
        statusCalls += 1;
        return HttpResponse.json(STATUS);
      }),
      http.put(BASE, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            errors: { serviceAccountJson: ['must be valid service-account JSON'] },
          },
          { status: 422 },
        ),
      ),
    );

    const Wrapper = wrapper();
    const status = renderHook(() => useStoreCredentialStatus(PID, APP_ID), { wrapper: Wrapper });
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(statusCalls).toBe(1);

    const set = renderHook(() => useSetStoreCredentials(PID, APP_ID), { wrapper: Wrapper });
    act(() => {
      set.result.current.mutate({ kind: 'google_play', serviceAccountJson: 'not-json' });
    });

    await waitFor(() => expect(set.result.current.isError).toBe(true));
    const error = set.result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.problem).toMatchObject({
      status: 422,
      errors: { serviceAccountJson: ['must be valid service-account JSON'] },
    });
    expect(statusCalls).toBe(1);
  });
});

describe('useDisconnectStoreCredentials', () => {
  it('DELETEs the store-credentials path and invalidates the apps list + status query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenMethod = '';
    let appsCalls = 0;
    let statusCalls = 0;
    server.use(
      http.get(APPS, () => {
        appsCalls += 1;
        return HttpResponse.json([APP]);
      }),
      http.get(`${BASE}/status`, () => {
        statusCalls += 1;
        return HttpResponse.json(STATUS);
      }),
      http.delete(BASE, ({ request }) => {
        seenUrl = request.url;
        seenMethod = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const Wrapper = wrapper();
    const apps = renderHook(() => useRcApps(PID), { wrapper: Wrapper });
    const status = renderHook(() => useStoreCredentialStatus(PID, APP_ID), { wrapper: Wrapper });
    await waitFor(() => expect(apps.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(appsCalls).toBe(1);
    expect(statusCalls).toBe(1);

    const disconnect = renderHook(() => useDisconnectStoreCredentials(PID, APP_ID), {
      wrapper: Wrapper,
    });
    act(() => {
      disconnect.result.current.mutate();
    });

    await waitFor(() => expect(disconnect.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}`);
    expect(seenMethod).toBe('DELETE');
    await waitFor(() => expect(appsCalls).toBe(2));
    await waitFor(() => expect(statusCalls).toBe(2));
  });
});
