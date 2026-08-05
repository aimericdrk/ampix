import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/problem';
import { server } from '../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { authStore } from '../auth/store';
import {
  rcCustomerDetailKey,
  rcCustomersListKey,
  useDeleteCustomer,
  useGrantPromotionalEntitlement,
  useRcCustomer,
  useRcCustomers,
  useRefundSubscription,
  useRevokePromotionalEntitlement,
  type RcCustomerDetail,
  type RcCustomerList,
  type RcCustomerRow,
  type RcPromotionalEntitlement,
  type RcRefundSubscriptionResult,
} from './customers-api';

const PID = TEST_PROJECT.id;
const BASE = `/api/v1/projects/${PID}/customers`;

const CUSTOMER_ROW: RcCustomerRow = {
  id: 'cust-1',
  appUserId: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  activeSubscriptionCount: 1,
  totalSpentCents: 999,
  currency: 'USD',
};

const CUSTOMER_ROW_2: RcCustomerRow = {
  id: 'cust-2',
  appUserId: 'user-2',
  createdAt: '2026-01-02T00:00:00.000Z',
  lastSeenAt: null,
  activeSubscriptionCount: 0,
  totalSpentCents: 0,
  currency: null,
};

const PROMO_ENTITLEMENT: RcPromotionalEntitlement = {
  id: 'promo-1',
  entitlementIdentifier: 'pro',
  grantedAt: '2026-07-01T00:00:00.000Z',
  startsAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
  revokedAt: null,
  note: 'VIP',
};

const CUSTOMER_DETAIL: RcCustomerDetail = {
  customer: {
    id: 'cust-1',
    appUserId: 'user-1',
    appleAppAccountToken: null,
    googleObfuscatedId: null,
    attributes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
  },
  customerInfo: {
    entitlements: {
      active: {
        pro: {
          isActive: true,
          willRenew: true,
          periodType: 'normal',
          latestPurchaseDate: '2026-06-01T00:00:00.000Z',
          originalPurchaseDate: '2026-01-01T00:00:00.000Z',
          expirationDate: '2026-08-01T00:00:00.000Z',
          store: 'app_store',
          productIdentifier: 'pro_monthly',
          unsubscribeDetectedAt: null,
          billingIssueDetectedAt: null,
          ownershipType: 'PURCHASED',
        },
      },
      all: {},
    },
    subscriptions: [],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-07-01T00:00:00.000Z',
  },
  subscriptions: [
    {
      id: 'sub-1',
      projectId: PID,
      customerId: 'cust-1',
      appId: 'app-1',
      productId: 'prod-1',
      storeProductId: 'pro_monthly',
      store: 'APP_STORE',
      environment: 'PRODUCTION',
      status: 'ACTIVE',
      periodType: 'NORMAL',
      ownershipType: 'PURCHASED',
      originalTransactionId: 'txn-orig-1',
      purchaseToken: null,
      purchasedAt: '2026-06-01T00:00:00.000Z',
      originalPurchasedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
      autoRenewStatus: true,
      autoRenewProductId: null,
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      gracePeriodExpiresAt: null,
      refundedAt: null,
      priceCents: 999,
      currency: 'USD',
      lastEventAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  ],
  transactions: [
    {
      id: 'txn-1',
      projectId: PID,
      customerId: 'cust-1',
      appId: 'app-1',
      subscriptionId: 'sub-1',
      store: 'APP_STORE',
      environment: 'PRODUCTION',
      storeTransactionId: 'store-txn-1',
      originalTransactionId: 'txn-orig-1',
      storeProductId: 'pro_monthly',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      purchasedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
      priceCents: 999,
      currency: 'USD',
      isTrialPeriod: false,
      revokedAt: null,
      rawPayload: { raw: true },
      createdAt: '2026-06-01T00:00:00.000Z',
    },
  ],
  promotionalEntitlements: [PROMO_ENTITLEMENT],
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('rcCustomersListKey', () => {
  it('is keyed by project, the list tag, and search', () => {
    expect(rcCustomersListKey(PID, '')).toEqual(['rc-customers', PID, 'list', '']);
    expect(rcCustomersListKey(PID, 'ada')).not.toEqual(rcCustomersListKey(PID, ''));
  });
});

describe('rcCustomerDetailKey', () => {
  it('is keyed by project, the detail tag, and customerId', () => {
    expect(rcCustomerDetailKey(PID, 'cust-1')).toEqual(['rc-customers', PID, 'detail', 'cust-1']);
  });
});

describe('useRcCustomers', () => {
  it('GETs the list path with search + limit and parses items/nextCursor', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    const page: RcCustomerList = { items: [CUSTOMER_ROW], nextCursor: 'cust-1|2026-01-01' };
    server.use(
      http.get(BASE, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(page);
      }),
    );

    const { result } = renderHook(() => useRcCustomers(PID, { search: 'user' }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}?search=user&limit=25`);
    expect(result.current.data?.pages).toEqual([page]);
  });

  it('fetchNextPage sends the previous page nextCursor as the cursor param', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    const seenUrls: string[] = [];
    const page1: RcCustomerList = { items: [CUSTOMER_ROW], nextCursor: 'cust-1|2026-01-01' };
    const page2: RcCustomerList = { items: [CUSTOMER_ROW_2], nextCursor: null };
    server.use(
      http.get(BASE, ({ request }) => {
        seenUrls.push(request.url);
        return HttpResponse.json(seenUrls.length === 1 ? page1 : page2);
      }),
    );

    const { result } = renderHook(() => useRcCustomers(PID, { search: '' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      void result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(seenUrls[1]).toBe(
      `http://localhost:3000${BASE}?search=&limit=25&cursor=cust-1%7C2026-01-01`,
    );
    expect(result.current.data?.pages[1]).toEqual(page2);
  });
});

describe('useRcCustomer', () => {
  it('GETs the detail path and returns the parsed body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`${BASE}/:customerId`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(CUSTOMER_DETAIL);
      }),
    );

    const { result } = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1`);
    expect(result.current.data).toEqual(CUSTOMER_DETAIL);
  });
});

describe('useGrantPromotionalEntitlement', () => {
  it('POSTs the body to the nested promotional-entitlements path and invalidates the detail query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    let detailCalls = 0;
    server.use(
      http.get(`${BASE}/:customerId`, () => {
        detailCalls += 1;
        return HttpResponse.json(CUSTOMER_DETAIL);
      }),
      http.post(`${BASE}/:customerId/promotional-entitlements`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json(PROMO_ENTITLEMENT, { status: 201 });
      }),
    );

    const Wrapper = wrapper();
    const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detailCalls).toBe(1);

    const grant = renderHook(() => useGrantPromotionalEntitlement(PID, 'cust-1'), {
      wrapper: Wrapper,
    });
    act(() => {
      grant.result.current.mutate({ entitlementId: 'ent-1', duration: 'monthly', note: 'VIP' });
    });

    await waitFor(() => expect(grant.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1/promotional-entitlements`);
    expect(seenBody).toEqual({ entitlementId: 'ent-1', duration: 'monthly', note: 'VIP' });
    expect(grant.result.current.data).toEqual(PROMO_ENTITLEMENT);
    await waitFor(() => expect(detailCalls).toBe(2));
  });
});

describe('useRevokePromotionalEntitlement', () => {
  it('DELETEs the nested promotional-entitlements/:grantId path and invalidates the detail query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let detailCalls = 0;
    server.use(
      http.get(`${BASE}/:customerId`, () => {
        detailCalls += 1;
        return HttpResponse.json(CUSTOMER_DETAIL);
      }),
      http.delete(`${BASE}/:customerId/promotional-entitlements/:grantId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const Wrapper = wrapper();
    const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detailCalls).toBe(1);

    const revoke = renderHook(() => useRevokePromotionalEntitlement(PID, 'cust-1'), {
      wrapper: Wrapper,
    });
    act(() => {
      revoke.result.current.mutate('promo-1');
    });

    await waitFor(() => expect(revoke.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1/promotional-entitlements/promo-1`);
    await waitFor(() => expect(detailCalls).toBe(2));
  });
});

describe('useDeleteCustomer', () => {
  it('DELETEs the customer path and invalidates both the detail and the list query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let detailCalls = 0;
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/:customerId`, () => {
        detailCalls += 1;
        return HttpResponse.json(CUSTOMER_DETAIL);
      }),
      http.get(BASE, () => {
        listCalls += 1;
        return HttpResponse.json({ items: [CUSTOMER_ROW], nextCursor: null });
      }),
      http.delete(`${BASE}/:customerId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const Wrapper = wrapper();
    const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
    const list = renderHook(() => useRcCustomers(PID, { search: '' }), { wrapper: Wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(detailCalls).toBe(1);
    expect(listCalls).toBe(1);

    const del = renderHook(() => useDeleteCustomer(PID), { wrapper: Wrapper });
    act(() => {
      del.result.current.mutate('cust-1');
    });

    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1`);
    await waitFor(() => expect(detailCalls).toBe(2));
    await waitFor(() => expect(listCalls).toBe(2));
  });
});

describe('useRefundSubscription', () => {
  it('POSTs the nested subscriptions/:subscriptionId/refund path with no body and invalidates the detail query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody = 'unset';
    let detailCalls = 0;
    const refunded: RcRefundSubscriptionResult = {
      id: 'sub-1',
      status: 'REVOKED',
      refundedAt: '2026-07-21T00:00:00.000Z',
    };
    server.use(
      http.get(`${BASE}/:customerId`, () => {
        detailCalls += 1;
        return HttpResponse.json(CUSTOMER_DETAIL);
      }),
      http.post(
        `${BASE}/:customerId/subscriptions/:subscriptionId/refund`,
        async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.text();
          return HttpResponse.json(refunded);
        },
      ),
    );

    const Wrapper = wrapper();
    const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detailCalls).toBe(1);

    const refund = renderHook(() => useRefundSubscription(PID, 'cust-1'), { wrapper: Wrapper });
    act(() => {
      refund.result.current.mutate('sub-1');
    });

    await waitFor(() => expect(refund.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1/subscriptions/sub-1/refund`);
    expect(seenBody).toBe('');
    expect(refund.result.current.data).toEqual(refunded);
    await waitFor(() => expect(detailCalls).toBe(2));
  });

  it('surfaces a 503 problem body as ApiError and does not invalidate the detail query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let detailCalls = 0;
    server.use(
      http.get(`${BASE}/:customerId`, () => {
        detailCalls += 1;
        return HttpResponse.json(CUSTOMER_DETAIL);
      }),
      http.post(`${BASE}/:customerId/subscriptions/:subscriptionId/refund`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Store credentials unavailable', status: 503 },
          { status: 503 },
        ),
      ),
    );

    const Wrapper = wrapper();
    const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detailCalls).toBe(1);

    const refund = renderHook(() => useRefundSubscription(PID, 'cust-1'), { wrapper: Wrapper });
    act(() => {
      refund.result.current.mutate('sub-1');
    });

    await waitFor(() => expect(refund.result.current.isError).toBe(true));
    const error = refund.result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.problem).toMatchObject({ status: 503, title: 'Store credentials unavailable' });
    expect(detailCalls).toBe(1);
  });
});
