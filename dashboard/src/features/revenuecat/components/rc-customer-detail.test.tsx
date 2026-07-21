import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';
import type { RcEntitlement } from '../catalog-api';
import type {
  RcCustomerDetail,
  RcCustomerDetailCustomer,
  RcCustomerInfo,
  RcPromotionalEntitlement,
  RcSubscriptionRow,
  RcTransactionRow,
} from '../customers-api';

const PID = TEST_PROJECT.id;
const CUSTOMER_ID = 'cust-1';
const DETAIL_URL = `/projects/${PID}/rc/customers/${CUSTOMER_ID}`;
const customersBase = `/api/v1/projects/${PID}/customers`;
const catalogBase = `/api/v1/projects/${PID}/catalog`;

function problem(status: number, title: string) {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

const ENTITLEMENT_VIP: RcEntitlement = { id: 'ent-vip', identifier: 'vip', displayName: 'VIP Access' };

const CUSTOMER: RcCustomerDetailCustomer = {
  id: CUSTOMER_ID,
  appUserId: 'user-42',
  appleAppAccountToken: null,
  googleObfuscatedId: null,
  attributes: { plan: 'gold' },
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-06-01T00:00:00.000Z',
};

const SUBSCRIPTION: RcSubscriptionRow = {
  id: 'sub-1',
  projectId: PID,
  customerId: CUSTOMER_ID,
  appId: 'app-1',
  productId: 'prod-1',
  storeProductId: 'com.example.monthly',
  store: 'APP_STORE',
  environment: 'PRODUCTION',
  status: 'ACTIVE',
  periodType: 'NORMAL',
  ownershipType: 'PURCHASED',
  originalTransactionId: 'txn-orig-1',
  purchaseToken: null,
  purchasedAt: '2026-05-01T00:00:00.000Z',
  originalPurchasedAt: '2026-05-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
  autoRenewStatus: true,
  autoRenewProductId: null,
  unsubscribeDetectedAt: null,
  billingIssueDetectedAt: null,
  gracePeriodExpiresAt: null,
  refundedAt: null,
  priceCents: 999,
  currency: 'USD',
  lastEventAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

/** A refundable Google Play subscription — the one row the Refund action may appear on (refund
 *  design §2: `PLAY_STORE` + still-entitled status + not yet refunded). */
const GOOGLE_SUBSCRIPTION: RcSubscriptionRow = {
  ...SUBSCRIPTION,
  id: 'sub-google-1',
  store: 'PLAY_STORE',
  storeProductId: 'com.example.play.monthly',
  purchaseToken: 'play-token-1',
};

/** Already refunded — status stays in the refundable set (`CANCELLED`) so the hidden button is
 *  attributable to `refundedAt` alone. */
const REFUNDED_GOOGLE_SUBSCRIPTION: RcSubscriptionRow = {
  ...GOOGLE_SUBSCRIPTION,
  id: 'sub-google-refunded',
  storeProductId: 'com.example.play.refunded',
  status: 'CANCELLED',
  refundedAt: '2026-06-15T00:00:00.000Z',
};

/** Google but no longer entitled — `EXPIRED` is outside the refundable status set. */
const EXPIRED_GOOGLE_SUBSCRIPTION: RcSubscriptionRow = {
  ...GOOGLE_SUBSCRIPTION,
  id: 'sub-google-expired',
  storeProductId: 'com.example.play.expired',
  status: 'EXPIRED',
};

const TRANSACTION: RcTransactionRow = {
  id: 'txn-1',
  projectId: PID,
  customerId: CUSTOMER_ID,
  appId: 'app-1',
  subscriptionId: 'sub-1',
  store: 'APP_STORE',
  environment: 'PRODUCTION',
  storeTransactionId: 'store-txn-1',
  originalTransactionId: 'txn-orig-1',
  storeProductId: 'com.example.monthly',
  type: 'AUTO_RENEWABLE_SUBSCRIPTION',
  purchasedAt: '2026-05-01T00:00:00.000Z',
  expiresAt: '2026-06-01T00:00:00.000Z',
  priceCents: 999,
  currency: 'USD',
  isTrialPeriod: false,
  revokedAt: null,
  rawPayload: { raw: true },
  createdAt: '2026-05-01T00:00:00.000Z',
};

function customerInfoFixture(): RcCustomerInfo {
  const premium = {
    isActive: true,
    willRenew: true,
    periodType: 'normal' as const,
    latestPurchaseDate: '2026-05-01T00:00:00.000Z',
    originalPurchaseDate: '2026-05-01T00:00:00.000Z',
    expirationDate: '2026-08-01T00:00:00.000Z',
    store: 'app_store' as const,
    productIdentifier: 'com.example.monthly',
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ownershipType: 'PURCHASED' as const,
  };
  return {
    entitlements: { active: { premium }, all: { premium } },
    subscriptions: [],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-06-01T00:00:00.000Z',
  };
}

/** The `EntitlementInfo` shape a promotional grant produces per design §1.2's union rule. */
function promotionalEntitlementInfo(grant: RcPromotionalEntitlement) {
  return {
    isActive: true,
    willRenew: false,
    periodType: 'promo' as const,
    latestPurchaseDate: grant.grantedAt,
    originalPurchaseDate: grant.grantedAt,
    expirationDate: grant.expiresAt,
    store: 'promotional' as const,
    productIdentifier: 'promotional',
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ownershipType: 'PURCHASED' as const,
  };
}

/**
 * Registers a stateful in-memory mock of the customer-detail + catalog-entitlements +
 * promotional grant/revoke + delete-customer endpoints for one test, mirroring
 * `RcOfferingsPage`'s `mockCatalog` helper — mutates the seeded state in place so a
 * grant/revoke/delete is visible on the next GET (read-your-writes, like the real service).
 */
function mockCustomerDetail(
  seedGrants: RcPromotionalEntitlement[] = [],
  subscriptions: RcSubscriptionRow[] = [SUBSCRIPTION],
) {
  const state: RcCustomerDetail = {
    customer: { ...CUSTOMER },
    customerInfo: customerInfoFixture(),
    subscriptions: subscriptions.map((sub) => ({ ...sub })),
    transactions: [TRANSACTION],
    promotionalEntitlements: seedGrants,
  };
  let deleted = false;
  let nextGrantId = 1;

  server.use(
    http.get(`${catalogBase}/entitlements`, () => HttpResponse.json([ENTITLEMENT_VIP])),
    http.get(`${customersBase}/:customerId`, () => {
      if (deleted) return problem(404, 'Customer not found');
      return HttpResponse.json(state);
    }),
    http.post(`${customersBase}/:customerId/promotional-entitlements`, async ({ request }) => {
      const body = (await request.json()) as { entitlementId: string; duration: string; note?: string };
      if (body.entitlementId !== ENTITLEMENT_VIP.id) return problem(404, 'Entitlement not found');
      const grant: RcPromotionalEntitlement = {
        id: `grant-${nextGrantId++}`,
        entitlementIdentifier: ENTITLEMENT_VIP.identifier,
        grantedAt: '2026-07-20T00:00:00.000Z',
        startsAt: '2026-07-20T00:00:00.000Z',
        expiresAt: body.duration === 'lifetime' ? null : '2026-08-20T00:00:00.000Z',
        revokedAt: null,
        note: body.note ?? null,
      };
      state.promotionalEntitlements = [...state.promotionalEntitlements, grant];
      state.customerInfo = {
        ...state.customerInfo,
        entitlements: {
          active: {
            ...state.customerInfo.entitlements.active,
            [ENTITLEMENT_VIP.identifier]: promotionalEntitlementInfo(grant),
          },
          all: {
            ...state.customerInfo.entitlements.all,
            [ENTITLEMENT_VIP.identifier]: promotionalEntitlementInfo(grant),
          },
        },
      };
      return HttpResponse.json(grant, { status: 201 });
    }),
    http.delete(`${customersBase}/:customerId/promotional-entitlements/:grantId`, ({ params }) => {
      state.promotionalEntitlements = state.promotionalEntitlements.map((grant) =>
        grant.id === params.grantId ? { ...grant, revokedAt: '2026-07-20T01:00:00.000Z' } : grant,
      );
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${customersBase}/:customerId/subscriptions/:subscriptionId/refund`, ({ params }) => {
      const sub = state.subscriptions.find((candidate) => candidate.id === params.subscriptionId);
      if (!sub) return problem(404, 'Subscription not found');
      sub.status = 'REVOKED';
      sub.refundedAt = '2026-07-21T00:00:00.000Z';
      return HttpResponse.json({ id: sub.id, status: sub.status, refundedAt: sub.refundedAt });
    }),
    http.delete(`${customersBase}/:customerId`, () => {
      deleted = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

function signInOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('RcCustomerDetailPage', () => {
  it('renders entitlements, subscriptions, transactions, attributes, and a back-link to the list', async () => {
    signInOwner();
    mockCustomerDetail([
      {
        id: 'grant-existing',
        entitlementIdentifier: 'vip',
        grantedAt: '2026-06-01T00:00:00.000Z',
        startsAt: '2026-06-01T00:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
        note: 'VIP comp',
      },
    ]);
    renderApp(DETAIL_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('user-42')).toBeInTheDocument();

    const entitlementsTable = within(screen.getByRole('table', { name: 'Customer entitlements' }));
    expect(entitlementsTable.getByText('premium')).toBeInTheDocument();
    expect(entitlementsTable.getByText('Active')).toBeInTheDocument();

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    expect(subsTable.getByText('com.example.monthly')).toBeInTheDocument();

    const txTable = within(screen.getByRole('table', { name: 'Customer transactions' }));
    expect(txTable.getByText('com.example.monthly')).toBeInTheDocument();
    expect(txTable.getByText('$9.99')).toBeInTheDocument();

    const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
    expect(grantsTable.getByText('vip')).toBeInTheDocument();
    expect(grantsTable.getByText('VIP comp')).toBeInTheDocument();

    const attributesTable = within(screen.getByRole('table', { name: 'Customer attributes' }));
    expect(attributesTable.getByText('plan')).toBeInTheDocument();
    expect(attributesTable.getByText('gold')).toBeInTheDocument();

    const link = main.getByRole('link', { name: 'Customers' });
    expect(link).toHaveAttribute('href', `/projects/${PID}/rc/customers`);
  });

  it('grants a promotional entitlement via the dialog, which appears with a Promotional badge', async () => {
    signInOwner();
    // Seed a revoked, unrelated grant so the "Promotional entitlements" list starts non-empty —
    // otherwise the "Grant promotional entitlement" button renders TWICE (card header + the
    // EmptyState action), same duplication `RcOfferingsPage`'s own "Add package" button has, and
    // its test avoids the same way (seed a non-empty list before clicking).
    mockCustomerDetail([
      {
        id: 'grant-legacy',
        entitlementIdentifier: 'legacy',
        grantedAt: '2026-01-01T00:00:00.000Z',
        startsAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-02-01T00:00:00.000Z',
        revokedAt: '2026-02-01T00:00:00.000Z',
        note: null,
      },
    ]);
    renderApp(DETAIL_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('user-42');

    await userEvent.click(main.getByRole('button', { name: 'Grant promotional entitlement' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.selectOptions(dialog.getByLabelText('Entitlement'), ENTITLEMENT_VIP.id);
    await userEvent.selectOptions(dialog.getByLabelText('Duration'), 'lifetime');
    await userEvent.type(dialog.getByLabelText('Note (optional)'), 'Comped by support');
    await userEvent.click(dialog.getByRole('button', { name: 'Grant' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
    expect(await grantsTable.findByText('Comped by support')).toBeInTheDocument();
    const vipGrantRow = grantsTable.getByText('vip').closest('tr') as HTMLElement;
    expect(within(vipGrantRow).getByText('Active')).toBeInTheDocument();

    const entitlementsTable = within(screen.getByRole('table', { name: 'Customer entitlements' }));
    const vipEntitlementRow = entitlementsTable.getByText('vip').closest('tr') as HTMLElement;
    expect(within(vipEntitlementRow).getByText('Promotional')).toBeInTheDocument();
  });

  it('grants the first entitlement on a first-open Grant click, without touching the Entitlement select', async () => {
    // Regression test: `GrantEntitlementDialog` mounts (unconditionally, behind `canManage`) before
    // `useRcEntitlements` resolves, so its `useState(entitlements[0]?.id ?? '')` initializer used to
    // lock `entitlementId` to '' forever — even after entitlements loaded and the native <select>
    // visually showed the first option. An admin who opened the dialog and clicked "Grant" without
    // manually re-selecting got a false "Choose an entitlement." error. This exercises exactly that
    // path: no `userEvent.selectOptions` call before submit.
    signInOwner();
    mockCustomerDetail([
      {
        id: 'grant-legacy',
        entitlementIdentifier: 'legacy',
        grantedAt: '2026-01-01T00:00:00.000Z',
        startsAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-02-01T00:00:00.000Z',
        revokedAt: '2026-02-01T00:00:00.000Z',
        note: null,
      },
    ]);
    renderApp(DETAIL_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('user-42');

    await userEvent.click(main.getByRole('button', { name: 'Grant promotional entitlement' }));
    const dialog = within(await screen.findByRole('dialog'));

    // Confirm the select has already pre-populated with the first (only) entitlement — this is the
    // state the buggy version also reached visually, while `entitlementId` silently stayed ''.
    const entitlementSelect = (await dialog.findByLabelText('Entitlement')) as HTMLSelectElement;
    await waitFor(() => expect(entitlementSelect.value).toBe(ENTITLEMENT_VIP.id));

    await userEvent.click(dialog.getByRole('button', { name: 'Grant' }));

    // The buggy path shows "Choose an entitlement." and keeps the dialog open instead of granting.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
    const vipGrantRow = (await grantsTable.findByText('vip')).closest('tr') as HTMLElement;
    expect(within(vipGrantRow).getByText('Active')).toBeInTheDocument();
  });

  it('revokes an active promotional grant', async () => {
    signInOwner();
    mockCustomerDetail([
      {
        id: 'grant-1',
        entitlementIdentifier: 'vip',
        grantedAt: '2026-06-01T00:00:00.000Z',
        startsAt: '2026-06-01T00:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
        note: null,
      },
    ]);
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');
    const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
    const grantRow = grantsTable.getByText('vip').closest('tr') as HTMLElement;

    await userEvent.click(within(grantRow).getByRole('button', { name: 'Revoke' }));
    const alert = within(await screen.findByRole('alertdialog'));
    await userEvent.click(alert.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => {
      const refreshedRow = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }))
        .getByText('vip')
        .closest('tr') as HTMLElement;
      expect(within(refreshedRow).getByText('Revoked')).toBeInTheDocument();
      expect(within(refreshedRow).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    });
  });

  it('deletes the customer after confirming, then navigates back to the customers list', async () => {
    signInOwner();
    mockCustomerDetail();
    const { router } = renderApp(DETAIL_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('user-42');

    await userEvent.click(main.getByRole('button', { name: 'Delete customer' }));
    const alert = within(await screen.findByRole('alertdialog'));
    await userEvent.click(alert.getByRole('button', { name: 'Delete customer' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PID}/rc/customers`));
  });

  it('renders read-only for a viewer: reads are visible, no write controls render', async () => {
    signInOwner();
    server.use(
      http.get('/api/v1/projects', () => HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] })),
    );
    mockCustomerDetail([
      {
        id: 'grant-1',
        entitlementIdentifier: 'vip',
        grantedAt: '2026-06-01T00:00:00.000Z',
        startsAt: '2026-06-01T00:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
        note: null,
      },
    ]);
    renderApp(DETAIL_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('user-42')).toBeInTheDocument();
    expect(main.getByText('vip')).toBeInTheDocument(); // reads still visible to a viewer

    expect(main.queryByRole('button', { name: 'Grant promotional entitlement' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete customer' })).not.toBeInTheDocument();
  });

  it('shows Refund only on a refundable Google Play subscription (APP_STORE / refunded / EXPIRED get none)', async () => {
    signInOwner();
    mockCustomerDetail(
      [],
      [GOOGLE_SUBSCRIPTION, SUBSCRIPTION, REFUNDED_GOOGLE_SUBSCRIPTION, EXPIRED_GOOGLE_SUBSCRIPTION],
    );
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    expect(subsTable.getAllByRole('button', { name: 'Refund' })).toHaveLength(1);

    const googleRow = subsTable.getByText('com.example.play.monthly').closest('tr') as HTMLElement;
    expect(within(googleRow).getByRole('button', { name: 'Refund' })).toBeInTheDocument();

    for (const productId of ['com.example.monthly', 'com.example.play.refunded', 'com.example.play.expired']) {
      const row = subsTable.getByText(productId).closest('tr') as HTMLElement;
      expect(within(row).queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
    }
  });

  it('hides Refund from a viewer even on a refundable Google Play subscription', async () => {
    signInOwner();
    server.use(
      http.get('/api/v1/projects', () => HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] })),
    );
    mockCustomerDetail([], [GOOGLE_SUBSCRIPTION]);
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    expect(subsTable.getByText('com.example.play.monthly')).toBeInTheDocument();
    expect(subsTable.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
  });

  it('refunds a Google Play subscription after confirming: POST, success toast, row re-renders REVOKED', async () => {
    signInOwner();
    mockCustomerDetail([], [GOOGLE_SUBSCRIPTION]);
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    await userEvent.click(subsTable.getByRole('button', { name: 'Refund' }));

    const alert = within(await screen.findByRole('alertdialog'));
    expect(alert.getByText('Refund subscription')).toBeInTheDocument();
    expect(
      alert.getByText(/Refund the last payment and revoke this subscription immediately\?/),
    ).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: 'Refund' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Refund issued')).toBeInTheDocument();

    await waitFor(() => {
      const refreshedTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
      const row = refreshedTable.getByText('com.example.play.monthly').closest('tr') as HTMLElement;
      expect(within(row).getByText('REVOKED')).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
    });
  });
});
