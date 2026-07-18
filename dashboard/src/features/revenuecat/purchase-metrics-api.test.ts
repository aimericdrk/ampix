import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { authStore } from '../auth/store';
import {
  rcMetricsKey,
  useRcActiveSubscriptions,
  useRcMrr,
  useRcRevenue,
  type RcActiveSubscriptionsResponse,
  type RcMrrResponse,
  type RcRevenueResponse,
} from './purchase-metrics-api';

const PID = TEST_PROJECT.id;
const FROM = '2026-06-18';
const TO = '2026-07-18';

const REVENUE: RcRevenueResponse = {
  currency: 'USD',
  totalCents: 123400,
  series: [
    { bucket: '2026-07-01', amountCents: 50000 },
    { bucket: '2026-07-02', amountCents: 73400 },
  ],
  byCurrency: [{ currency: 'USD', totalCents: 123400 }],
};
const MRR: RcMrrResponse = {
  currency: 'USD',
  mrrCents: 4995,
  series: [{ bucket: '2026-07-01', mrrCents: 4995 }],
  unattributedActiveCount: 2,
  approximate: true,
};
const ACTIVE: RcActiveSubscriptionsResponse = {
  current: 42,
  series: [{ bucket: '2026-07-01', count: 40 }],
  approximate: true,
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('rcMetricsKey', () => {
  it('is keyed by project, metric, range, and granularity', () => {
    expect(rcMetricsKey(PID, 'revenue', FROM, TO, 'day')).toEqual([
      'rc-purchase-metrics',
      PID,
      'revenue',
      FROM,
      TO,
      'day',
    ]);
    // Granularity is part of the key so switching day↔month refetches instead of serving stale data.
    expect(rcMetricsKey(PID, 'mrr', FROM, TO, 'day')).not.toEqual(
      rcMetricsKey(PID, 'mrr', FROM, TO, 'month'),
    );
  });
});

describe('purchase metrics hooks', () => {
  it('useRcRevenue hits /metrics/revenue on the purchase service and returns the parsed body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`/api/v1/projects/${PID}/metrics/revenue`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(REVENUE);
      }),
    );

    const { result } = renderHook(() => useRcRevenue(PID, FROM, TO, 'day'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(REVENUE);
    const url = new URL(seenUrl);
    expect(url.searchParams.get('from')).toBe(FROM);
    expect(url.searchParams.get('to')).toBe(TO);
    expect(url.searchParams.get('granularity')).toBe('day');
  });

  it('useRcMrr returns the MRR body including the approximation caveat fields', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`/api/v1/projects/${PID}/metrics/mrr`, () => HttpResponse.json(MRR)));

    const { result } = renderHook(() => useRcMrr(PID, FROM, TO, 'week'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mrrCents).toBe(4995);
    expect(result.current.data?.unattributedActiveCount).toBe(2);
    expect(result.current.data?.approximate).toBe(true);
  });

  it('useRcActiveSubscriptions returns the current count and series', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(
      http.get(`/api/v1/projects/${PID}/metrics/active-subscriptions`, () => HttpResponse.json(ACTIVE)),
    );

    const { result } = renderHook(() => useRcActiveSubscriptions(PID, FROM, TO, 'month'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.current).toBe(42);
  });

  it('stays idle (no fetch) until both range bounds are set', () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    // No handler registered: if the hook fired, MSW's onUnhandledRequest:'error' would fail the test.
    const { result } = renderHook(() => useRcRevenue(PID, '', '', 'day'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('respects an explicit enabled:false even with a valid range', () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    const { result } = renderHook(() => useRcMrr(PID, FROM, TO, 'day', { enabled: false }), {
      wrapper: wrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
