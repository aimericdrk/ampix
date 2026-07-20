import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';
import type { RcOffering, RcPackageType, RcProduct } from '../catalog-api';

const PID = TEST_PROJECT.id;
const OFFERINGS_URL = `/projects/${PID}/rc/offerings`;
const base = `/api/v1/projects/${PID}/catalog`;

function problem(status: number, title: string) {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

const PRODUCT_MONTHLY: RcProduct = {
  id: 'prod-monthly',
  appId: 'app-1',
  storeProductId: 'com.example.monthly',
  type: 'AUTO_RENEWABLE_SUBSCRIPTION',
  displayName: 'Monthly Pro',
  priceCents: 999,
  currency: 'USD',
  durationIso8601: 'P1M',
  subscriptionGroupId: null,
  entitlements: [],
};
const PRODUCT_ANNUAL: RcProduct = {
  id: 'prod-annual',
  appId: 'app-1',
  storeProductId: 'com.example.annual',
  type: 'AUTO_RENEWABLE_SUBSCRIPTION',
  displayName: 'Annual Pro',
  priceCents: 8999,
  currency: 'USD',
  durationIso8601: 'P1Y',
  subscriptionGroupId: null,
  entitlements: [],
};

const OFFERING_DEFAULT: RcOffering = {
  id: 'off-default',
  identifier: 'default',
  displayName: 'Default',
  isCurrent: true,
  metadata: null,
  packages: [
    { id: 'pkg-monthly', identifier: '$rc_monthly', packageType: 'MONTHLY', productId: PRODUCT_MONTHLY.id, sortOrder: 1 },
  ],
};
const OFFERING_PROMO: RcOffering = {
  id: 'off-promo',
  identifier: 'promo',
  displayName: 'Promo',
  isCurrent: false,
  metadata: { campaign: 'summer' },
  packages: [],
};

/**
 * Registers a stateful in-memory mock of the `catalog` offerings + products endpoints for one
 * test — `mobile_purchase` isn't reachable from a dashboard test, and none of these routes live in
 * the shared `handlers.ts` fixture (this sub-project is their first dashboard consumer). Mutates
 * the seeded arrays in place so a create/set-current/add/edit/remove is visible on the next GET,
 * mirroring the real service's read-your-writes behavior.
 */
function mockCatalog(offerings: RcOffering[], products: RcProduct[]) {
  const state = { offerings: offerings.map((o) => ({ ...o, packages: [...o.packages] })), products };
  let nextOfferingId = 1;
  let nextPackageId = 1;

  server.use(
    http.get(`${base}/offerings`, () => HttpResponse.json(state.offerings)),
    http.get(`${base}/products`, () => HttpResponse.json(state.products)),
    http.post(`${base}/offerings`, async ({ request }) => {
      const body = (await request.json()) as { identifier: string; displayName: string; metadata?: unknown };
      const created: RcOffering = {
        id: `off-new-${nextOfferingId++}`,
        identifier: body.identifier,
        displayName: body.displayName,
        isCurrent: false,
        metadata: body.metadata ?? null,
        packages: [],
      };
      state.offerings.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${base}/offerings/:offeringId/current`, ({ params }) => {
      state.offerings = state.offerings.map((o) => ({ ...o, isCurrent: o.id === params.offeringId }));
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch(`${base}/offerings/:offeringId`, async ({ params, request }) => {
      const index = state.offerings.findIndex((o) => o.id === params.offeringId);
      if (index === -1) return problem(404, 'Offering not found');
      const body = (await request.json()) as { displayName?: string; metadata?: unknown };
      state.offerings[index] = { ...state.offerings[index], ...body };
      return HttpResponse.json(state.offerings[index]);
    }),
    http.delete(`${base}/offerings/:offeringId`, ({ params }) => {
      state.offerings = state.offerings.filter((o) => o.id !== params.offeringId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${base}/offerings/:offeringId/packages`, async ({ params, request }) => {
      const offering = state.offerings.find((o) => o.id === params.offeringId);
      if (!offering) return problem(404, 'Offering not found');
      const body = (await request.json()) as {
        identifier: string;
        packageType: RcPackageType;
        productId: string;
        sortOrder?: number;
      };
      const created = {
        id: `pkg-new-${nextPackageId++}`,
        identifier: body.identifier,
        packageType: body.packageType,
        productId: body.productId,
        sortOrder: body.sortOrder ?? 0,
      };
      offering.packages = [...offering.packages, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(`${base}/offerings/:offeringId/packages/:packageId`, async ({ params, request }) => {
      const offering = state.offerings.find((o) => o.id === params.offeringId);
      if (!offering) return problem(404, 'Offering not found');
      const index = offering.packages.findIndex((p) => p.id === params.packageId);
      if (index === -1) return problem(404, 'Package not found');
      const body = (await request.json()) as { packageType?: RcPackageType; sortOrder?: number };
      offering.packages[index] = { ...offering.packages[index], ...body };
      return HttpResponse.json(offering.packages[index]);
    }),
    http.delete(`${base}/offerings/:offeringId/packages/:packageId`, ({ params }) => {
      const offering = state.offerings.find((o) => o.id === params.offeringId);
      if (offering) offering.packages = offering.packages.filter((p) => p.id !== params.packageId);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

function signInOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('RcOfferingsPage', () => {
  it('renders offerings with a current badge, package counts, and the current offering’s packages resolved to product names', async () => {
    signInOwner();
    mockCatalog([OFFERING_DEFAULT, OFFERING_PROMO], [PRODUCT_MONTHLY, PRODUCT_ANNUAL]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('default')).toBeInTheDocument();
    expect(main.getByText('promo')).toBeInTheDocument();
    // The DataTable has a "Current" column header AND the current-offering badge, so the badge must
    // be asserted row-scoped: present on "default", absent on "promo".
    const defaultRow = main.getByText('default').closest('tr') as HTMLElement;
    expect(within(defaultRow).getByText('Current')).toBeInTheDocument(); // current badge on "default"
    expect(within(defaultRow).getByText('1')).toBeInTheDocument(); // package count
    const promoRow = main.getByText('promo').closest('tr') as HTMLElement;
    expect(within(promoRow).queryByText('Current')).not.toBeInTheDocument(); // "promo" not current
    expect(within(promoRow).getByText('0')).toBeInTheDocument();

    // Detail pane defaults to the current offering ("default").
    expect(main.getByText(/packages — default/i)).toBeInTheDocument();
    expect(main.getByText('$rc_monthly')).toBeInTheDocument();
    expect(main.getByText('MONTHLY')).toBeInTheDocument();
    expect(main.getByText('Monthly Pro (com.example.monthly)')).toBeInTheDocument();
  });

  it('creates an offering via the New offering dialog', async () => {
    signInOwner();
    mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('default');

    await userEvent.click(main.getByRole('button', { name: 'New offering' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Identifier'), 'promo');
    await userEvent.type(dialog.getByLabelText('Display name'), 'Promo');
    await userEvent.click(dialog.getByRole('button', { name: 'Create offering' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('promo')).toBeInTheDocument();
  });

  it('flips the current badge to a different offering after Set current', async () => {
    signInOwner();
    mockCatalog([OFFERING_DEFAULT, OFFERING_PROMO], [PRODUCT_MONTHLY]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('promo');

    const promoRow = main.getByText('promo').closest('tr') as HTMLElement;
    await userEvent.click(within(promoRow).getByRole('button', { name: 'Set current' }));

    await waitFor(() => {
      const refreshedPromoRow = main.getByText('promo').closest('tr') as HTMLElement;
      expect(within(refreshedPromoRow).getByText('Current')).toBeInTheDocument();
    });
    const defaultRow = main.getByText('default').closest('tr') as HTMLElement;
    expect(within(defaultRow).queryByText('Current')).not.toBeInTheDocument();
  });

  it('adds a package via the dialog, picking the product from useRcProducts', async () => {
    signInOwner();
    mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY, PRODUCT_ANNUAL]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('$rc_monthly');

    await userEvent.click(main.getByRole('button', { name: 'Add package' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Identifier'), '$rc_annual');

    await userEvent.click(dialog.getByRole('combobox', { name: 'Product' }));
    await userEvent.click(await screen.findByRole('option', { name: /Annual Pro/ }), { pointerEventsCheck: 0 });

    await userEvent.click(dialog.getByRole('button', { name: 'Add package' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('$rc_annual')).toBeInTheDocument();
    expect(main.getByText('Annual Pro (com.example.annual)')).toBeInTheDocument();
  });

  it('edits a package’s type and sort order', async () => {
    signInOwner();
    mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));
    const packageRow = (await main.findByText('$rc_monthly')).closest('tr') as HTMLElement;

    await userEvent.click(within(packageRow).getByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));

    await userEvent.click(dialog.getByRole('combobox', { name: 'Package type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'ANNUAL' }), { pointerEventsCheck: 0 });

    const sortOrderInput = dialog.getByLabelText('Sort order');
    await userEvent.clear(sortOrderInput);
    await userEvent.type(sortOrderInput, '5');

    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const updatedRow = (await main.findByText('$rc_monthly')).closest('tr') as HTMLElement;
    expect(within(updatedRow).getByText('ANNUAL')).toBeInTheDocument();
    expect(within(updatedRow).getByText('5')).toBeInTheDocument();
  });

  it('removes a package via the alert-dialog confirm', async () => {
    signInOwner();
    mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));
    const packageRow = (await main.findByText('$rc_monthly')).closest('tr') as HTMLElement;

    await userEvent.click(within(packageRow).getByRole('button', { name: 'Remove' }));
    const alert = within(await screen.findByRole('alertdialog'));
    await userEvent.click(alert.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(main.queryByText('$rc_monthly')).not.toBeInTheDocument();
    expect(await main.findByText('No packages in this offering')).toBeInTheDocument();
  });

  it('renders read-only for a viewer: offerings and packages are visible, no write controls render', async () => {
    signInOwner();
    server.use(
      http.get('/api/v1/projects', () => HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] })),
    );
    mockCatalog([OFFERING_DEFAULT, OFFERING_PROMO], [PRODUCT_MONTHLY]);
    renderApp(OFFERINGS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('default')).toBeInTheDocument();
    expect(main.getByText('$rc_monthly')).toBeInTheDocument(); // packages still visible to a viewer

    expect(main.queryByRole('button', { name: 'New offering' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Set current' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Add package' })).not.toBeInTheDocument();
    expect(main.queryAllByRole('button', { name: 'Edit' })).toHaveLength(0);
    expect(main.queryAllByRole('button', { name: 'Delete' })).toHaveLength(0);
    expect(main.queryAllByRole('button', { name: 'Remove' })).toHaveLength(0);
    // The read-only "View packages" toggle is still available.
    expect(main.getAllByRole('button', { name: 'View packages' }).length).toBeGreaterThan(0);
  });
});
