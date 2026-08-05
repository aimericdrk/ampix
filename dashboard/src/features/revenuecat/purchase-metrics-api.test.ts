import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { authStore } from '../auth/store';
import type { SubscriptionsSummaryResponse } from '../../lib/api/types';
import {
  rcMetricsKey,
  useRcActiveSubscriptions,
  useRcMrr,
  useRcRevenue,
  useRcSummary,
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
const SUMMARY: SubscriptionsSummaryResponse = {
  mrr_cents: 4995,
  active: 5,
  in_trial: 2,
  grace: 1,
  new_subscriptions: 3,
  churned: 1,
  trials_started: 4,
  trials_converted: 2,
  by_day: [{ t: '2026-07-01', new_subscriptions: 1, churned: 0, revenue: 999 }],
  by_product: [{ product_id: 'pro_monthly', active: 3, mrr_cents: 2997 }],
  by_store: [{ store: 'app_store', active: 3 }],
  churn_reasons: [{ reason: 'voluntary', count: 1 }],
  recent_events: [
    {
      insert_id: 'rcevt-1',
      event: '$rc_initial_purchase',
      distinct_id: 'user-001',
      timestamp: '2026-07-01T09:58:00.000Z',
      product_id: 'pro_monthly',
      price: 9.99,
    },
  ],
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

  it('useRcSummary hits /metrics/summary on the purchase service and returns the parsed body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`/api/v1/projects/${PID}/metrics/summary`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(SUMMARY);
      }),
    );

    const { result } = renderHook(() => useRcSummary(PID, FROM, TO), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SUMMARY);
    const url = new URL(seenUrl);
    expect(url.searchParams.get('from')).toBe(FROM);
    expect(url.searchParams.get('to')).toBe(TO);
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
