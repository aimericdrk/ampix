import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  orgsState,
  projectsHandlerWithoutRc,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const PRODUCTS_URL = `/projects/${TEST_PROJECT.id}/rc/products`;
const catalogBase = `/api/v1/projects/${TEST_PROJECT.id}/catalog`;

function problem(status: number, title: string) {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

interface FixtureApp {
  id: string;
  name: string;
  platform: string;
  bundleId: string | null;
  packageName: string | null;
  publicSdkKey: string;
}
interface FixtureEntitlement {
  id: string;
  identifier: string;
  displayName: string;
}
interface FixtureProduct {
  id: string;
  appId: string;
  storeProductId: string;
  type: string;
  displayName: string;
  priceCents: number | null;
  currency: string | null;
  durationIso8601: string | null;
  subscriptionGroupId: string | null;
  entitlementIds: string[];
}

let apps: FixtureApp[];
let entitlements: FixtureEntitlement[];
let products: FixtureProduct[];
let nextId: number;

function resetCatalogFixture() {
  apps = [
    {
      id: 'app-1',
      name: 'App One',
      platform: 'IOS',
      bundleId: 'com.example.one',
      packageName: null,
      publicSdkKey: 'mp_pub_one',
    },
    {
      id: 'app-2',
      name: 'App Two',
      platform: 'ANDROID',
      bundleId: null,
      packageName: 'com.example.two',
      publicSdkKey: 'mp_pub_two',
    },
  ];
  entitlements = [
    { id: 'ent-pro', identifier: 'pro', displayName: 'Pro access' },
    { id: 'ent-plus', identifier: 'pro_plus', displayName: 'Pro Plus' },
  ];
  products = [
    {
      id: 'prod-1',
      appId: 'app-1',
      storeProductId: 'pro_monthly',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      displayName: 'Pro Monthly',
      priceCents: 999,
      currency: 'USD',
      durationIso8601: 'P1M',
      subscriptionGroupId: 'group-1',
      entitlementIds: ['ent-pro'],
    },
    {
      id: 'prod-2',
      appId: 'app-1',
      storeProductId: 'coins_100',
      type: 'CONSUMABLE',
      displayName: '100 Coins',
      priceCents: null,
      currency: null,
      durationIso8601: null,
      subscriptionGroupId: null,
      entitlementIds: [],
    },
    {
      id: 'prod-3',
      appId: 'app-2',
      storeProductId: 'pro_annual_android',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      displayName: 'Pro Annual',
      priceCents: 5999,
      currency: 'USD',
      durationIso8601: 'P1Y',
      subscriptionGroupId: null,
      entitlementIds: ['ent-pro', 'ent-plus'],
    },
  ];
  // Starts well above the fixture's hardcoded app-1/app-2/prod-1/prod-2/prod-3 ids so a freshly
  // created app/product never collides with an existing fixture row (e.g. nextId starting at 1
  // would mint `app-2`, duplicating the existing "App Two" and hiding the "auto-select the new
  // app" assertion behind the pre-existing option of the same value).
  nextId = 100;
}

function toRcApp(a: FixtureApp) {
  return {
    id: a.id,
    name: a.name,
    platform: a.platform,
    bundleId: a.bundleId,
    packageName: a.packageName,
    publicSdkKey: a.publicSdkKey,
  };
}
function toRcEntitlement(e: FixtureEntitlement) {
  return { id: e.id, identifier: e.identifier, displayName: e.displayName };
}
function toRcProduct(p: FixtureProduct) {
  return {
    id: p.id,
    appId: p.appId,
    storeProductId: p.storeProductId,
    type: p.type,
    displayName: p.displayName,
    priceCents: p.priceCents,
    currency: p.currency,
    durationIso8601: p.durationIso8601,
    subscriptionGroupId: p.subscriptionGroupId,
    entitlements: p.entitlementIds.map((id) => toRcEntitlement(entitlements.find((e) => e.id === id)!)),
  };
}

function installCatalogHandlers() {
  server.use(
    http.get(`${catalogBase}/apps`, () => HttpResponse.json(apps.map(toRcApp))),
    http.post(`${catalogBase}/apps`, async ({ request }) => {
      const body = (await request.json()) as {
        name: string;
        platform: string;
        bundleId?: string;
        packageName?: string;
      };
      nextId += 1;
      const created: FixtureApp = {
        id: `app-${nextId}`,
        name: body.name,
        platform: body.platform,
        bundleId: body.bundleId ?? null,
        packageName: body.packageName ?? null,
        publicSdkKey: `mp_pub_${nextId}`,
      };
      apps.push(created);
      return HttpResponse.json(toRcApp(created), { status: 201 });
    }),
    http.delete(`${catalogBase}/apps/:appId`, ({ params }) => {
      const appId = params.appId as string;
      if (!apps.some((a) => a.id === appId)) return problem(404, 'App not found');
      apps = apps.filter((a) => a.id !== appId);
      products = products.filter((p) => p.appId !== appId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${catalogBase}/entitlements`, () => HttpResponse.json(entitlements.map(toRcEntitlement))),
    http.get(`${catalogBase}/products`, () => HttpResponse.json(products.map(toRcProduct))),
    http.post(`${catalogBase}/products`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      nextId += 1;
      const created: FixtureProduct = {
        id: `prod-${nextId}`,
        appId: body.appId as string,
        storeProductId: body.storeProductId as string,
        type: body.type as string,
        displayName: body.displayName as string,
        priceCents: (body.priceCents as number | undefined) ?? null,
        currency: (body.currency as string | undefined) ?? null,
        durationIso8601: (body.durationIso8601 as string | undefined) ?? null,
        subscriptionGroupId: (body.subscriptionGroupId as string | undefined) ?? null,
        entitlementIds: [],
      };
      products.push(created);
      return HttpResponse.json(toRcProduct(created), { status: 201 });
    }),
    http.patch(`${catalogBase}/products/:productId`, async ({ params, request }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product) return problem(404, 'Product not found');
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.displayName === 'string') product.displayName = body.displayName;
      if ('priceCents' in body) product.priceCents = (body.priceCents as number | undefined) ?? null;
      if ('currency' in body) product.currency = (body.currency as string | undefined) ?? null;
      if ('durationIso8601' in body) {
        product.durationIso8601 = (body.durationIso8601 as string | undefined) ?? null;
      }
      if ('subscriptionGroupId' in body) {
        product.subscriptionGroupId = (body.subscriptionGroupId as string | undefined) ?? null;
      }
      return HttpResponse.json(toRcProduct(product));
    }),
    http.delete(`${catalogBase}/products/:productId`, ({ params }) => {
      if (!products.some((p) => p.id === params.productId)) return problem(404, 'Product not found');
      products = products.filter((p) => p.id !== params.productId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${catalogBase}/products/:productId/entitlements`, async ({ params, request }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product) return problem(404, 'Product not found');
      const { entitlementId } = (await request.json()) as { entitlementId: string };
      if (!product.entitlementIds.includes(entitlementId)) product.entitlementIds.push(entitlementId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${catalogBase}/products/:productId/entitlements/:entitlementId`, ({ params }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product) return problem(404, 'Product not found');
      product.entitlementIds = product.entitlementIds.filter((id) => id !== params.entitlementId);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

beforeEach(() => {
  resetCatalogFixture();
  installCatalogHandlers();
});

describe('RcProductsPage', () => {
  it('shows the connect upsell (not products) when RevenueCat is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(main.queryByLabelText('App')).not.toBeInTheDocument();
  });

  it('lists the apps in the selector and filters products to the selected app', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));

    const appSelect = (await main.findByLabelText('App')) as HTMLSelectElement;
    expect(appSelect).toHaveValue('app-1');
    expect(await main.findByText('pro_monthly')).toBeInTheDocument();
    expect(main.getByText('100 Coins')).toBeInTheDocument();
    expect(main.queryByText('pro_annual_android')).not.toBeInTheDocument();

    await userEvent.selectOptions(appSelect, 'app-2');
    expect(await main.findByText('pro_annual_android')).toBeInTheDocument();
    expect(main.queryByText('pro_monthly')).not.toBeInTheDocument();
  });

  it('renders price, duration, type badge, and entitlement badges from the fixture', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    const row = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    expect(within(row).getByText('$9.99')).toBeInTheDocument();
    expect(within(row).getByText('P1M')).toBeInTheDocument();
    expect(within(row).getByText('pro')).toBeInTheDocument();
    expect(within(row).getByText(/auto-renewable subscription/i)).toBeInTheDocument();

    const coinsRow = main.getByText('100 Coins').closest('tr') as HTMLElement;
    // No price, no duration, no entitlements — three separate dash cells on this row.
    expect(within(coinsRow).getAllByText('—')).toHaveLength(3);
  });

  it('creates a new product via the New product dialog', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    await userEvent.click(main.getByRole('button', { name: 'New product' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Store product ID'), 'pro_yearly');
    await userEvent.type(dialog.getByLabelText('Display name'), 'Pro Yearly');
    await userEvent.click(dialog.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('pro_yearly')).toBeInTheDocument();
  });

  it('attaches and detaches entitlements via Manage entitlements, updating the row live', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly'); // fixture: only "pro" attached

    const row = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Manage entitlements' }));

    const dialog = within(await screen.findByRole('dialog'));
    const proCheckbox = dialog.getByRole('checkbox', { name: /pro access/i });
    const proPlusCheckbox = dialog.getByRole('checkbox', { name: /pro plus/i });
    expect(proCheckbox).toBeChecked();
    expect(proPlusCheckbox).not.toBeChecked();

    await userEvent.click(proPlusCheckbox); // attach
    await waitFor(() => expect(proPlusCheckbox).toBeChecked());
    await userEvent.click(proCheckbox); // detach
    await waitFor(() => expect(proCheckbox).not.toBeChecked());

    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const updatedRow = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    expect(within(updatedRow).getByText('pro_plus')).toBeInTheDocument();
    expect(within(updatedRow).queryByText('pro')).not.toBeInTheDocument();
  });

  it('edits a product, keeping storeProductId and type read-only', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    const row = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByLabelText('Store product ID')).not.toBeInTheDocument();
    expect(dialog.getByText(/pro_monthly/)).toBeInTheDocument(); // read-only identity line
    const nameField = dialog.getByLabelText('Display name');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Pro Monthly (renamed)');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Pro Monthly (renamed)')).toBeInTheDocument();
  });

  it('deletes a product via the confirm alert-dialog', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('100 Coins');

    const row = main.getByText('100 Coins').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    const alert = within(await screen.findByRole('alertdialog'));
    await userEvent.click(alert.getByRole('button', { name: 'Delete product' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText('100 Coins')).not.toBeInTheDocument();
  });

  it('creates a new app and auto-selects it in the app selector', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    await userEvent.click(main.getByRole('button', { name: 'New app' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'App Three');
    await userEvent.type(dialog.getByLabelText('Bundle ID'), 'com.example.three'); // platform defaults to IOS
    await userEvent.click(dialog.getByRole('button', { name: 'Create app' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const appSelect = main.getByLabelText('App') as HTMLSelectElement;
    await waitFor(() => {
      const selected = within(appSelect).getByRole('option', { selected: true });
      expect(selected.textContent).toContain('App Three');
    });
    expect(await main.findByText(/no products yet/i)).toBeInTheDocument();
  });

  it('deletes an app via the confirm alert-dialog, removing it and its products', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly'); // App One selected by default

    await userEvent.click(main.getByRole('button', { name: 'Delete app' }));
    const alert = within(await screen.findByRole('alertdialog'));
    expect(alert.getByText(/removes the app and every product/i)).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: 'Delete app' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const appSelect = (await main.findByLabelText('App')) as HTMLSelectElement;
    expect(within(appSelect).queryByRole('option', { name: /App One/ })).not.toBeInTheDocument();
    expect(await main.findByText('pro_annual_android')).toBeInTheDocument();
    expect(main.queryByText('pro_monthly')).not.toBeInTheDocument();
  });

  it('shows an empty state prompting New app when the project has no apps yet', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`${catalogBase}/apps`, () => HttpResponse.json([])));
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText(/no apps yet/i)).toBeInTheDocument();
    expect(main.getByRole('button', { name: 'New app' })).toBeInTheDocument();
    expect(main.queryByLabelText('App')).not.toBeInTheDocument();
  });

  it('shows a fully read-only surface for a viewer, with no write controls', async () => {
    // Downgrade MFA_USER (an admin on TEST_PROJECT) to viewer for this scenario only — same pattern
    // as ProjectMembersSection's "analyst (read-only)" test.
    const membership = orgsState.projectMemberships.find(
      (m) => m.projectId === TEST_PROJECT.id && m.user.id === MFA_USER.id,
    );
    if (membership) membership.role = 'viewer';
    authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);

    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    expect(main.getByLabelText('App')).toBeInTheDocument(); // the read surface stays visible
    expect(main.queryByRole('button', { name: 'New product' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'New app' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete app' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Manage entitlements' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
