import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../../features/auth/store';
import { TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { purchaseApiFetch } from './purchase-client';

const fetchMock = vi.fn();

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.contentType ?? 'application/json' },
  });
}

describe('purchaseApiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.___MYAMPIX_CONFIG__;
  });

  it('prefixes the configured purchaseApiBaseUrl before the path', async () => {
    window.___MYAMPIX_CONFIG__ = { purchaseApiBaseUrl: 'https://purchase.myampix.example' };
    fetchMock.mockResolvedValue(jsonResponse({ current: 3 }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/active-subscriptions');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://purchase.myampix.example/api/v1/projects/p1/metrics/active-subscriptions',
    );
  });

  it('defaults to same-origin (no prefix) when purchaseApiBaseUrl is unset', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ current: 0 }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/active-subscriptions');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/projects/p1/metrics/active-subscriptions');
  });

  it('forwards the Authorization bearer + Content-Type from the shared auth store and sends credentials', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/mrr', {
      method: 'POST',
      body: { from: '2026-06-01' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${VALID_ACCESS_TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify({ from: '2026-06-01' }));
  });

  it('omits the Authorization header when there is no session token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ current: 0 }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/active-subscriptions');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ current: 42 }));

    const body = await purchaseApiFetch<{ current: number }>(
      '/api/v1/projects/p1/metrics/active-subscriptions',
    );

    expect(body).toEqual({ current: 42 });
  });

  it('maps an RFC 7807 problem body to ApiError with the parsed problem', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Invalid query',
          status: 400,
          detail: 'from must be an ISO date',
        },
        { status: 400, contentType: 'application/problem+json' },
      ),
    );

    await expect(
      purchaseApiFetch('/api/v1/projects/p1/metrics/revenue?from=nope'),
    ).rejects.toMatchObject({
      name: 'ApiError',
      problem: { status: 400, title: 'Invalid query', detail: 'from must be an ISO date' },
    });
  });
});
