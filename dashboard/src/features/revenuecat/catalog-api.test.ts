import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { authStore } from '../auth/store';
import {
  rcCatalogKey,
  useAddPackage,
  useAttachEntitlement,
  useCreateRcApp,
  useCreateRcEntitlement,
  useCreateRcOffering,
  useCreateRcProduct,
  useDeleteRcApp,
  useDeleteRcEntitlement,
  useDeleteRcOffering,
  useDeleteRcProduct,
  useDetachEntitlement,
  useRcApps,
  useRcEntitlements,
  useRcOfferings,
  useRcProducts,
  useRemovePackage,
  useSetCurrentOffering,
  useUpdatePackage,
  useUpdateRcEntitlement,
  useUpdateRcOffering,
  useUpdateRcProduct,
  type RcApp,
  type RcEntitlement,
  type RcOffering,
  type RcPackage,
  type RcProduct,
} from './catalog-api';

const PID = TEST_PROJECT.id;
const BASE = `/api/v1/projects/${PID}/catalog`;

const APP: RcApp = {
  id: 'app-1',
  name: 'Demo iOS',
  platform: 'IOS',
  bundleId: 'com.demo.app',
  packageName: null,
  publicSdkKey: 'mp_pub_abc123',
};

const ENTITLEMENT: RcEntitlement = { id: 'ent-1', identifier: 'pro', displayName: 'Pro' };

const PRODUCT: RcProduct = {
  id: 'prod-1',
  appId: 'app-1',
  storeProductId: 'pro_monthly',
  type: 'AUTO_RENEWABLE_SUBSCRIPTION',
  displayName: 'Pro Monthly',
  priceCents: 999,
  currency: 'USD',
  durationIso8601: 'P1M',
  subscriptionGroupId: null,
  entitlements: [ENTITLEMENT],
};

const PACKAGE: RcPackage = {
  id: 'pkg-1',
  identifier: '$rc_monthly',
  packageType: 'MONTHLY',
  productId: 'prod-1',
  sortOrder: 0,
};

const OFFERING: RcOffering = {
  id: 'off-1',
  identifier: 'default',
  displayName: 'Default',
  isCurrent: true,
  metadata: null,
  packages: [PACKAGE],
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('rcCatalogKey', () => {
  it('is keyed by project and resource', () => {
    expect(rcCatalogKey(PID, 'apps')).toEqual(['rc-catalog', PID, 'apps']);
    expect(rcCatalogKey(PID, 'products')).not.toEqual(rcCatalogKey(PID, 'offerings'));
  });
});

describe('apps', () => {
  it('useRcApps GETs the apps list and returns the parsed body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`${BASE}/apps`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([APP]);
      }),
    );

    const { result } = renderHook(() => useRcApps(PID), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([APP]);
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/apps`);
  });

  it('useCreateRcApp POSTs the body and returns the created app', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenBody: unknown;
    server.use(
      http.post(`${BASE}/apps`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(APP, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useCreateRcApp(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ name: 'Demo iOS', platform: 'IOS', bundleId: 'com.demo.app' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ name: 'Demo iOS', platform: 'IOS', bundleId: 'com.demo.app' });
    expect(result.current.data).toEqual(APP);
  });

  it('useDeleteRcApp DELETEs the app by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.delete(`${BASE}/apps/:appId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useDeleteRcApp(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate('app-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/apps/app-1`);
  });
});

describe('entitlements', () => {
  it('useRcEntitlements GETs the entitlements list and returns the parsed body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`${BASE}/entitlements`, () => HttpResponse.json([ENTITLEMENT])));

    const { result } = renderHook(() => useRcEntitlements(PID), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([ENTITLEMENT]);
  });

  it('useCreateRcEntitlement POSTs the body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenBody: unknown;
    server.use(
      http.post(`${BASE}/entitlements`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(ENTITLEMENT, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useCreateRcEntitlement(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ identifier: 'pro', displayName: 'Pro' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ identifier: 'pro', displayName: 'Pro' });
  });

  it('useUpdateRcEntitlement PATCHes the entitlement by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.patch(`${BASE}/entitlements/:entitlementId`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({ ...ENTITLEMENT, displayName: 'Pro tier' });
      }),
    );

    const { result } = renderHook(() => useUpdateRcEntitlement(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ id: 'ent-1', displayName: 'Pro tier' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/entitlements/ent-1`);
    expect(seenBody).toEqual({ displayName: 'Pro tier' });
    expect(result.current.data?.displayName).toBe('Pro tier');
  });

  it('useDeleteRcEntitlement DELETEs the entitlement by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.delete(`${BASE}/entitlements/:entitlementId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useDeleteRcEntitlement(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate('ent-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/entitlements/ent-1`);
  });
});

describe('products', () => {
  it('useRcProducts GETs the products list including nested entitlements', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`${BASE}/products`, () => HttpResponse.json([PRODUCT])));

    const { result } = renderHook(() => useRcProducts(PID), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([PRODUCT]);
    expect(result.current.data?.[0]?.entitlements).toEqual([ENTITLEMENT]);
  });

  it('useCreateRcProduct POSTs the body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenBody: unknown;
    server.use(
      http.post(`${BASE}/products`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(PRODUCT, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useCreateRcProduct(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({
        appId: 'app-1',
        storeProductId: 'pro_monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Pro Monthly',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({
      appId: 'app-1',
      storeProductId: 'pro_monthly',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      displayName: 'Pro Monthly',
    });
  });

  it('useUpdateRcProduct PATCHes the product by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.patch(`${BASE}/products/:productId`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({ ...PRODUCT, displayName: 'Pro Monthly (renamed)' });
      }),
    );

    const { result } = renderHook(() => useUpdateRcProduct(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ id: 'prod-1', displayName: 'Pro Monthly (renamed)' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1`);
    expect(seenBody).toEqual({ displayName: 'Pro Monthly (renamed)' });
  });

  it('useDeleteRcProduct DELETEs the product by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.delete(`${BASE}/products/:productId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useDeleteRcProduct(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate('prod-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1`);
  });

  it('useAttachEntitlement POSTs to the nested products/:id/entitlements path and invalidates products', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/products`, () => {
        listCalls += 1;
        return HttpResponse.json([PRODUCT]);
      }),
      http.post(`${BASE}/products/:productId/entitlements`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const Wrapper = wrapper();
    const list = renderHook(() => useRcProducts(PID), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(listCalls).toBe(1);

    const attach = renderHook(() => useAttachEntitlement(PID), { wrapper: Wrapper });
    act(() => {
      attach.result.current.mutate({ productId: 'prod-1', entitlementId: 'ent-2' });
    });

    await waitFor(() => expect(attach.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1/entitlements`);
    expect(seenBody).toEqual({ entitlementId: 'ent-2' });
    // The products list query was invalidated by the attach mutation and refetched.
    await waitFor(() => expect(listCalls).toBe(2));
  });

  it('useDetachEntitlement DELETEs the nested products/:id/entitlements/:id path', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.delete(`${BASE}/products/:productId/entitlements/:entitlementId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useDetachEntitlement(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ productId: 'prod-1', entitlementId: 'ent-1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1/entitlements/ent-1`);
  });
});

describe('offerings', () => {
  it('useRcOfferings GETs the offerings list including nested packages', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`${BASE}/offerings`, () => HttpResponse.json([OFFERING])));

    const { result } = renderHook(() => useRcOfferings(PID), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([OFFERING]);
    expect(result.current.data?.[0]?.packages).toEqual([PACKAGE]);
  });

  it('useCreateRcOffering POSTs the body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenBody: unknown;
    server.use(
      http.post(`${BASE}/offerings`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(OFFERING, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useCreateRcOffering(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ identifier: 'default', displayName: 'Default' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ identifier: 'default', displayName: 'Default' });
  });

  it('useUpdateRcOffering PATCHes the offering by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.patch(`${BASE}/offerings/:offeringId`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({ ...OFFERING, displayName: 'Default (renamed)' });
      }),
    );

    const { result } = renderHook(() => useUpdateRcOffering(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ id: 'off-1', displayName: 'Default (renamed)' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1`);
    expect(seenBody).toEqual({ displayName: 'Default (renamed)' });
  });

  it('useDeleteRcOffering DELETEs the offering by id', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.delete(`${BASE}/offerings/:offeringId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useDeleteRcOffering(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate('off-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1`);
  });

  it('useSetCurrentOffering POSTs to offerings/:id/current and invalidates offerings', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/offerings`, () => {
        listCalls += 1;
        return HttpResponse.json([OFFERING]);
      }),
      http.post(`${BASE}/offerings/:offeringId/current`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const Wrapper = wrapper();
    const list = renderHook(() => useRcOfferings(PID), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(listCalls).toBe(1);

    const setCurrent = renderHook(() => useSetCurrentOffering(PID), { wrapper: Wrapper });
    act(() => {
      setCurrent.result.current.mutate('off-2');
    });

    await waitFor(() => expect(setCurrent.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-2/current`);
    await waitFor(() => expect(listCalls).toBe(2));
  });

  it('useAddPackage POSTs to the nested offerings/:id/packages path', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.post(`${BASE}/offerings/:offeringId/packages`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json(PACKAGE, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useAddPackage(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({
        offeringId: 'off-1',
        identifier: '$rc_monthly',
        packageType: 'MONTHLY',
        productId: 'prod-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1/packages`);
    expect(seenBody).toEqual({ identifier: '$rc_monthly', packageType: 'MONTHLY', productId: 'prod-1' });
  });

  it('useUpdatePackage PATCHes the nested offerings/:id/packages/:id path', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.patch(`${BASE}/offerings/:offeringId/packages/:packageId`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({ ...PACKAGE, sortOrder: 2 });
      }),
    );

    const { result } = renderHook(() => useUpdatePackage(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ offeringId: 'off-1', packageId: 'pkg-1', sortOrder: 2 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1/packages/pkg-1`);
    expect(seenBody).toEqual({ sortOrder: 2 });
  });

  it('useRemovePackage DELETEs the nested offerings/:id/packages/:id path', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.delete(`${BASE}/offerings/:offeringId/packages/:packageId`, ({ request }) => {
        seenUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useRemovePackage(PID), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ offeringId: 'off-1', packageId: 'pkg-1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1/packages/pkg-1`);
  });
});
