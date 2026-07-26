# Dashboard Tool Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the dashboard sidebar into a narrow tool rail (MyAmplitude / MyRevenueCat) plus the selected tool's section list, and give MyRevenueCat the full RevenueCat-shaped IA.

**Architecture:** `nav-model.ts` gains a `TOOLS` array; the sidebar reads one tool's groups (`toolGroups`) while the command palette and keyboard shortcuts read every tool's (`allGroups`). Eight new flat `/projects/$projectId/rc/*` routes follow the existing convention. Today's `SubscriptionsPage` splits along its own query seam into `RcOverviewPage` (summary) and `RcConversionPage` (attribution).

**Tech Stack:** React 19, TanStack Router (flat route tree, full path strings), TanStack Query, Tailwind v4 (CSS-first, `data-accent` variables), Vitest + Testing Library + MSW, motion/react.

**Spec:** `docs/superpowers/specs/2026-07-16-dashboard-tool-rail-design.md`

## Global Constraints

- **Dashboard only.** No `backend/` changes. The RC backend service split is a separate project.
- **Never rename a lettered shortcut label.** `NAV_SHORTCUT_LETTERS` in `dashboard/src/features/shortcuts/keyboard-shortcuts.ts` is string-keyed on nav labels and silently drops unmatched entries — no type error, no failing test. The protected labels are exactly: `Home`, `Insights`, `Funnels`, `Retention`, `Users`, `Dashboards`, `Revenue`.
- **`aria-label` values are load-bearing.** The rail is `Tools`; the section list stays `Primary`. Do not rename `Primary` — the existing sidebar test suite is scoped to it.
- **No RC page gets a shortcut letter.** This is what keeps `SHORTCUT_ROUTES` a module-level const.
- **No barrel `index.ts` files** (matches the repo).
- **Imports are relative.** The only path alias is `@myampix/contracts`.
- **The user commits.** Every task ends with a `git add` + `git commit` command written out; run them only if the user has said to. Never add `Co-Authored-By`.
- Verify with `npm run build` and `npm test` from `dashboard/`.
- Accents come from the five fixed hues only: `violet`, `cyan`, `lime`, `amber`, `pink`.

---

### Task 1: RC routes, page split, and placeholders

Splits `SubscriptionsPage` along its query seam and lands all eight `/rc/*` routes. The old `/subscriptions` URL becomes a redirect, so the existing nav entry keeps working untouched — that is what makes this task shippable on its own.

**Files:**
- Create: `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx`
- Create: `dashboard/src/features/revenuecat/components/RcConversionPage.tsx`
- Create: `dashboard/src/features/revenuecat/components/RcPlaceholderPage.tsx`
- Delete: `dashboard/src/features/analytics/components/SubscriptionsPage.tsx`
- Modify: `dashboard/src/router.tsx`
- Test: `dashboard/src/features/revenuecat/components/rc-pages.test.tsx` (new)
- Delete: `dashboard/src/features/analytics/components/subscriptions.test.tsx`

**Interfaces:**
- Consumes: `useRcEnabled`, `useSubscriptionsSummary`, `useSubscriptionAttribution` from `dashboard/src/features/revenuecat/api.ts` (unchanged).
- Produces: `RcOverviewPage`, `RcConversionPage`, `RcPlaceholderPage` (props: `{ title: string; description: string }`). Routes `/projects/$projectId/rc/{overview,conversion,charts,customers,products,entitlements,offerings,paywalls}`.

**Why the page split lands here:** `RcOverviewPage` is §0–5 fed by `useSubscriptionsSummary` (honors global filters); `RcConversionPage` is §6–8 fed by `useSubscriptionAttribution` (ignores global filters). Splitting also fixes a real bug: today §6–8 render *outside* the `{data && ...}` guard, so attribution shows even when the summary query fails.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/features/revenuecat/components/rc-pages.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  VALID_ACCESS_TOKEN,
  TEST_USER,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const OVERVIEW_URL = `/projects/${TEST_PROJECT.id}/rc/overview`;
const CONVERSION_URL = `/projects/${TEST_PROJECT.id}/rc/conversion`;

describe('RcOverviewPage', () => {
  it('renders KPI tiles, trend, churn donut, and breakdown tables from the summary', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(OVERVIEW_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('MRR')).toBeInTheDocument();
    expect(main.getByText('$49.95')).toBeInTheDocument(); // 4995 cents from the fixture
    expect(main.getByText('Active subscribers')).toBeInTheDocument();
    expect(main.getByText(/churn reasons/i)).toBeInTheDocument();
    expect(main.getByText(/by product/i)).toBeInTheDocument();
  });

  it('shows an upsell empty state when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(OVERVIEW_URL);
    const main = within(await screen.findByRole('main'));
    expect((await main.findAllByText(/connect revenuecat/i)).length).toBeGreaterThan(0);
  });

  it('does not render attribution sections', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(OVERVIEW_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('MRR');
    expect(main.queryByText(/time to convert/i)).not.toBeInTheDocument();
  });

  it('redirects the legacy /subscriptions URL to /rc/overview', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/subscriptions`);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('MRR')).toBeInTheDocument();
  });
});

describe('RcConversionPage', () => {
  it('renders drivers, time-to-convert, and trial funnel', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(CONVERSION_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText(/conversion drivers/i)).toBeInTheDocument();
    expect(main.getByText(/time to convert/i)).toBeInTheDocument();
    expect(main.getByText(/trial funnel/i)).toBeInTheDocument();
    // from SUBSCRIPTION_ATTRIBUTION_FIXTURE:
    expect(main.getByText('$screen_view')).toBeInTheDocument();
    expect(main.getByText('Paywall')).toBeInTheDocument();
  });

  it('does not render summary KPI tiles', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(CONVERSION_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText(/trial funnel/i);
    expect(main.queryByText('Active subscribers')).not.toBeInTheDocument();
  });
});

describe('RcPlaceholderPage', () => {
  it('renders a not-built-yet state for Customers', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/customers`);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(main.getByText(/not built yet/i)).toBeInTheDocument();
  });
});

describe('RcSettingsPage', () => {
  it('renders the RevenueCat integration card under the RC namespace', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/settings`);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: 'Integration settings' })).toBeInTheDocument();
    expect(await screen.findByTestId('rc-integration-card')).toBeInTheDocument();
  });
});
```

`rc-integration-card` is the existing `data-testid` on `IntegrationsSection`'s `Card`
(`IntegrationsSection.tsx:67`) — assert against it rather than adding a new hook.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/features/revenuecat/components/rc-pages.test.tsx`
Expected: FAIL — routes `/rc/overview`, `/rc/conversion`, `/rc/customers` do not exist, so the app renders NotFoundPage and `findByText('MRR')` times out.

- [ ] **Step 3: Create `RcPlaceholderPage`**

Create `dashboard/src/features/revenuecat/components/RcPlaceholderPage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';

/**
 * Stands in for a MyRevenueCat page whose data surface isn't built yet. Deliberately not a 404:
 * the nav lists the whole RevenueCat IA up front, so every entry must resolve to something that
 * explains itself rather than looking broken.
 */
export function RcPlaceholderPage({ title, description }: { title: string; description: string }) {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };

  return (
    <PageShell
      projectId={projectId}
      title={title}
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: title }]}
    >
      <EmptyState title={`${title} is not built yet`} description={description} />
    </PageShell>
  );
}
```

- [ ] **Step 4: Create `RcOverviewPage` (SubscriptionsPage §0–5)**

Create `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type {
  SubscriptionRecentEvent,
  SubscriptionsByProduct,
  SubscriptionsByStore,
} from '../../../lib/api/types';
import { useRcEnabled, useSubscriptionsSummary } from '../api';
import { colorForIndex } from '../../analytics/palette';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatCurrency, formatPercent } from '../../analytics/format';
import { mergeGlobalFilters, useGlobalFilters } from '../../analytics/global-filters';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { ComparisonTrend } from '../../analytics/components/charts/ComparisonTrend';
import { DonutChart } from '../../analytics/components/charts/DonutChart';
import { KpiTile } from '../../analytics/components/charts/KpiTile';

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop in one place (mirrors Revenue/Home). */
function chartState(
  isPending: boolean,
  isError: boolean,
  isEmpty: boolean,
): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading';
  if (isError) return 'error';
  if (isEmpty) return 'empty';
  return 'ready';
}

const BY_PRODUCT_COLUMNS: Array<DataTableColumn<SubscriptionsByProduct>> = [
  { key: 'product_id', header: 'Product', sortable: true },
  { key: 'active', header: 'Active', sortable: true, align: 'right' },
  {
    key: 'mrr',
    header: 'Monthly revenue',
    sortable: true,
    align: 'right',
    render: (row) => formatCurrency(row.mrr_cents / 100),
    sortValue: (row) => row.mrr_cents,
  },
];

const BY_STORE_COLUMNS: Array<DataTableColumn<SubscriptionsByStore>> = [
  { key: 'store', header: 'Store', sortable: true },
  { key: 'active', header: 'Active', sortable: true, align: 'right' },
];

const RECENT_EVENTS_COLUMNS: Array<DataTableColumn<SubscriptionRecentEvent>> = [
  {
    key: 'timestamp',
    header: 'Time',
    sortable: true,
    render: (row) => new Date(row.timestamp).toLocaleString(),
  },
  { key: 'event', header: 'Event', sortable: true },
  { key: 'distinct_id', header: 'User', sortable: true },
  { key: 'product_id', header: 'Product', sortable: true },
  {
    key: 'price',
    header: 'Price',
    sortable: true,
    align: 'right',
    render: (row) => formatCurrency(row.price),
  },
];

/**
 * MyRevenueCat → Overview. The RevenueCat-mirrored subscription summary (MRR, active/trial counts,
 * churn) for the selected range, from `useSubscriptionsSummary`. Attribution lives on the separate
 * Conversion page — the two are split along the query boundary, so neither straddles a data source.
 * Gated on `useRcEnabled`: projects without RevenueCat connected see an upsell empty state.
 */
export function RcOverviewPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/overview' });
  const rcEnabled = useRcEnabled(projectId);
  const { from, to } = useDateRange();
  const { filters: globalFilters } = useGlobalFilters();
  const subscriptions = useSubscriptionsSummary(projectId, from, to, mergeGlobalFilters([], globalFilters));

  if (!rcEnabled) {
    return (
      <PageShell
        projectId={projectId}
        title="Overview"
        description="Subscription analytics powered by RevenueCat."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Overview' }]}
      >
        <EmptyState
          title="Connect RevenueCat"
          description="Connect RevenueCat in project settings to see subscription analytics."
        />
      </PageShell>
    );
  }

  const data = subscriptions.data;

  const trend = data?.by_day.map((day) => ({ t: day.t, new_subscriptions: day.new_subscriptions })) ?? [];
  const churnSlices =
    data?.churn_reasons.map((reason) => ({ key: reason.reason, label: reason.reason, value: reason.count })) ?? [];
  const churnColor = new Map(churnSlices.map((slice, index) => [slice.key, colorForIndex(index)]));

  const trialsConverted = data?.trials_converted ?? 0;
  const trialsStarted = data?.trials_started ?? 0;
  const trialConversionRate = trialsStarted > 0 ? trialsConverted / trialsStarted : 0;

  return (
    <PageShell
      projectId={projectId}
      title="Overview"
      description="MRR, active subscribers, trials, and churn for the selected range."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Overview' }]}
      dateRangeControl={<DateRangeControl />}
    >
      {subscriptions.isPending && (
        <Reveal index={0}>
          <p role="status">Loading subscriptions summary…</p>
        </Reveal>
      )}
      {subscriptions.isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            Failed to load subscriptions summary
          </p>
        </Reveal>
      )}

      {data && (
        <>
          <Reveal index={0}>
            <SectionGrid>
              <KpiTile label="MRR" value={formatCurrency(data.mrr_cents / 100)} unfiltered />
              <KpiTile label="Active subscribers" value={data.active} unfiltered />
              <KpiTile label="In trial" value={data.in_trial} unfiltered />
              <KpiTile label="New subscriptions" value={data.new_subscriptions} />
              <KpiTile label="Churned" value={data.churned} />
              <KpiTile label="Trial→paid" value={formatPercent(trialConversionRate)} />
            </SectionGrid>
          </Reveal>

          <Reveal index={1}>
            <ChartCard
              title="New subscriptions"
              description="Daily new subscriptions for the selected range."
              state={chartState(subscriptions.isPending, subscriptions.isError, trend.length === 0)}
              exportImageName="subscriptions-new-trend"
            >
              <ComparisonTrend
                current={trend}
                xKey="t"
                valueKey="new_subscriptions"
                label="New subscriptions"
                ariaLabel="New subscriptions trend"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={2}>
            <ChartCard
              title="Churn reasons"
              state={chartState(subscriptions.isPending, subscriptions.isError, churnSlices.length === 0)}
            >
              <DonutChart
                slices={churnSlices}
                colorFor={(key) => churnColor.get(key) ?? 'var(--series-1)'}
                ariaLabel="Churn reasons composition"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={3}>
            <ChartCard title="By product">
              <DataTable
                columns={BY_PRODUCT_COLUMNS}
                rows={data.by_product}
                caption="Per-product subscription breakdown"
                initialSort={{ key: 'mrr', dir: 'desc' }}
                rowKey={(row) => row.product_id}
                exportFilename="subscriptions-by-product"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={4}>
            <ChartCard title="By store">
              <DataTable
                columns={BY_STORE_COLUMNS}
                rows={data.by_store}
                caption="Subscriptions by store"
                initialSort={{ key: 'active', dir: 'desc' }}
                rowKey={(row) => row.store}
                exportFilename="subscriptions-by-store"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={5}>
            <ChartCard title="Recent events">
              <DataTable
                columns={RECENT_EVENTS_COLUMNS}
                rows={data.recent_events}
                caption="Recent subscription events"
                initialSort={{ key: 'timestamp', dir: 'desc' }}
                rowKey={(row) => row.insert_id}
                exportFilename="subscriptions-recent-events"
              />
            </ChartCard>
          </Reveal>
        </>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 5: Create `RcConversionPage` (SubscriptionsPage §6–8)**

Create `dashboard/src/features/revenuecat/components/RcConversionPage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type {
  SubscriptionAttributionDriver,
  SubscriptionAttributionScreen,
  SubscriptionTimeToConvertBucket,
} from '../../../lib/api/types';
import { useRcEnabled, useSubscriptionAttribution } from '../api';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatPercent } from '../../analytics/format';
import { BreakdownChart } from '../../analytics/components/charts/BreakdownChart';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { KpiTile } from '../../analytics/components/charts/KpiTile';

const DRIVERS_COLUMNS: Array<DataTableColumn<SubscriptionAttributionDriver>> = [
  { key: 'event', header: 'Event', sortable: true },
  { key: 'users', header: 'Users', sortable: true, align: 'right' },
];

const SCREENS_COLUMNS: Array<DataTableColumn<SubscriptionAttributionScreen>> = [
  { key: 'screen_name', header: 'Screen', sortable: true },
  { key: 'users', header: 'Users', sortable: true, align: 'right' },
];

/** Fixed left-to-right order for the time-to-convert buckets — never trust API row order. */
const TIME_TO_CONVERT_BUCKET_ORDER = ['<1d', '1-3d', '3-7d', '7-14d', '14-30d', '30d+'];

function sortTimeToConvertBuckets(
  rows: SubscriptionTimeToConvertBucket[],
): SubscriptionTimeToConvertBucket[] {
  return [...rows].sort(
    (a, b) => TIME_TO_CONVERT_BUCKET_ORDER.indexOf(a.bucket) - TIME_TO_CONVERT_BUCKET_ORDER.indexOf(b.bucket),
  );
}

/**
 * MyRevenueCat → Conversion. Correlates RevenueCat subscription events against the SDK's own event
 * stream: which events and screens precede a trial-to-paid conversion, how long it takes, and the
 * trial funnel. Real RevenueCat cannot do this — it has no event stream — which is why this is
 * grouped under "Analyze" rather than mirroring RevenueCat's own IA.
 *
 * Unlike Overview, `useSubscriptionAttribution` ignores global filters, so this page carries no
 * filter-dependent state and owns its own loading/error handling.
 */
export function RcConversionPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/conversion' });
  const rcEnabled = useRcEnabled(projectId);
  const { from, to } = useDateRange();
  const attribution = useSubscriptionAttribution(projectId, from, to);

  if (!rcEnabled) {
    return (
      <PageShell
        projectId={projectId}
        title="Conversion"
        description="What drives trial-to-paid conversion."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Conversion' }]}
      >
        <EmptyState
          title="Connect RevenueCat"
          description="Connect RevenueCat in project settings to see conversion analytics."
        />
      </PageShell>
    );
  }

  const data = attribution.data;
  const driverRows = data?.drivers ?? [];
  const screenRows = data?.screens ?? [];
  const timeToConvertChartData = sortTimeToConvertBuckets(data?.time_to_convert ?? []).map((row) => ({
    label: row.bucket,
    segments: [{ key: 'users', value: row.users }],
  }));
  const trials = data?.trial_funnel.trials ?? 0;
  const converted = data?.trial_funnel.converted ?? 0;
  const funnelConversionRate = trials > 0 ? converted / trials : 0;
  const state = (isEmpty: boolean) =>
    attribution.isPending ? 'loading' : attribution.isError ? 'error' : isEmpty ? 'empty' : 'ready';

  return (
    <PageShell
      projectId={projectId}
      title="Conversion"
      description="Events, screens, and elapsed time that precede trial-to-paid conversion."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Conversion' }]}
      dateRangeControl={<DateRangeControl />}
    >
      <Reveal index={0}>
        <ChartCard
          title="Conversion drivers"
          description="Events and screens most associated with trial-to-paid conversion."
          state={state(driverRows.length === 0 && screenRows.length === 0)}
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DataTable
              columns={DRIVERS_COLUMNS}
              rows={driverRows}
              caption="Conversion driver events"
              initialSort={{ key: 'users', dir: 'desc' }}
              rowKey={(row) => row.event}
              exportFilename="subscriptions-attribution-drivers"
            />
            <DataTable
              columns={SCREENS_COLUMNS}
              rows={screenRows}
              caption="Conversion driver screens"
              initialSort={{ key: 'users', dir: 'desc' }}
              rowKey={(row) => row.screen_name}
              exportFilename="subscriptions-attribution-screens"
            />
          </div>
        </ChartCard>
      </Reveal>

      <Reveal index={1}>
        <ChartCard
          title="Time to convert"
          description="Elapsed time from trial start to conversion, bucketed."
          state={state(timeToConvertChartData.length === 0)}
        >
          {/* Stacked (single-segment) variant preserves the caller's bucket order — the
              non-stacked BreakdownChart always re-sorts descending by value, which would
              scramble this fixed time-bucket axis. */}
          <BreakdownChart stacked data={timeToConvertChartData} ariaLabel="Trial time-to-convert distribution" />
        </ChartCard>
      </Reveal>

      <Reveal index={2}>
        <ChartCard title="Trial funnel" state={state(trials === 0)}>
          <SectionGrid>
            <KpiTile label="Trials" value={trials} />
            <KpiTile label="Converted" value={converted} />
            <KpiTile label="Conversion rate" value={formatPercent(funnelConversionRate)} />
          </SectionGrid>
        </ChartCard>
      </Reveal>
    </PageShell>
  );
}
```

- [ ] **Step 6: Wire the routes**

In `dashboard/src/router.tsx`, remove the `SubscriptionsPage` import and add:

```tsx
import { RcConversionPage } from './features/revenuecat/components/RcConversionPage';
import { RcOverviewPage } from './features/revenuecat/components/RcOverviewPage';
import { RcPlaceholderPage } from './features/revenuecat/components/RcPlaceholderPage';
```

Replace the `subscriptionsRoute` block (currently `router.tsx:269-273`) with:

```tsx
// --- MyRevenueCat (tool rail, 2026-07-16) ---
// The legacy flat /subscriptions URL is kept as a redirect so existing links and bookmarks survive
// the move under the /rc/ namespace.

const subscriptionsRedirectRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/subscriptions',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/projects/$projectId/rc/overview', params });
  },
});

const rcOverviewRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/overview',
  component: RcOverviewPage,
});

const rcConversionRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/conversion',
  component: RcConversionPage,
});

const rcChartsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/charts',
  component: () => (
    <RcPlaceholderPage
      title="Charts"
      description="Explore MRR, subscribers, and churn over time with custom breakdowns."
    />
  ),
});

const rcCustomersRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/customers',
  component: () => (
    <RcPlaceholderPage
      title="Customers"
      description="Browse subscribers, their entitlements, and their purchase history."
    />
  ),
});

const rcProductsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/products',
  component: () => (
    <RcPlaceholderPage
      title="Products"
      description="The store products synced from RevenueCat, with their pricing and performance."
    />
  ),
});

const rcEntitlementsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/entitlements',
  component: () => (
    <RcPlaceholderPage
      title="Entitlements"
      description="The access levels your products grant, and who currently holds them."
    />
  ),
});

const rcOfferingsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/offerings',
  component: () => (
    <RcPlaceholderPage
      title="Offerings"
      description="The product bundles presented to users, and how each one converts."
    />
  ),
});

const rcPaywallsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/paywalls',
  component: () => (
    <RcPlaceholderPage
      title="Paywalls"
      description="The paywalls shown to users, and how each one performs."
    />
  ),
});

const rcSettingsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/settings',
  component: RcSettingsPage,
});
```

Confirm `redirect` is in the `@tanstack/react-router` import at the top of the file (it already is — `indexRoute` and `securitySettingsRoute` use it).

In the `privateRoute.addChildren([...])` array, replace `subscriptionsRoute,` with:

```tsx
    subscriptionsRedirectRoute,
    rcOverviewRoute,
    rcConversionRoute,
    rcChartsRoute,
    rcCustomersRoute,
    rcProductsRoute,
    rcEntitlementsRoute,
    rcOfferingsRoute,
    rcPaywallsRoute,
```

- [ ] **Step 6b: Create `RcSettingsPage`**

MyRevenueCat needs its own settings route. Linking its "Integration settings" item at
`/projects/$projectId` would eject you from the tool, because the active tool is derived from the
pathname and that path has no `/rc/` in it.

`IntegrationsSection` is already exported and already owns its `useRcStatus` call, rendering
`ConnectForm` when disconnected and `ConnectedPanel` when connected. So this reuses it whole — no
change to `IntegrationsSection` itself.

Create `dashboard/src/features/revenuecat/components/RcSettingsPage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationsSection } from '../../projects/components/IntegrationsSection';
import { useProjectRole } from '../../projects/api';

/**
 * MyRevenueCat → Integration settings. Its own route rather than a link into project settings, so
 * configuring the tool doesn't navigate you out of it. Reuses `IntegrationsSection` — which already
 * switches between the connect form and the connected panel off `useRcStatus` — so there is exactly
 * one RevenueCat connect/manage surface, rendered in two places.
 */
export function RcSettingsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/settings' });
  const role = useProjectRole(projectId);
  const isAdmin = role === 'admin' || role === 'owner';

  return (
    <PageShell
      projectId={projectId}
      title="Integration settings"
      description="Connect and manage the RevenueCat integration for this project."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Integration settings' }]}
    >
      {isAdmin ? (
        <IntegrationsSection projectId={projectId} />
      ) : (
        <EmptyState
          title="Only admins can manage integrations"
          description="Ask a project admin to connect or change the RevenueCat integration."
        />
      )}
    </PageShell>
  );
}
```

Confirm `useProjectRole`'s import path by checking `ProjectDetailPage.tsx`'s import block — it is
the same hook that file uses at line 53. Add to `router.tsx`:

```tsx
import { RcSettingsPage } from './features/revenuecat/components/RcSettingsPage';
```

and add `rcSettingsRoute,` to the `privateRoute.addChildren([...])` array alongside the other RC routes.

- [ ] **Step 7: Delete the old page and its test**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix
git rm dashboard/src/features/analytics/components/SubscriptionsPage.tsx
git rm dashboard/src/features/analytics/components/subscriptions.test.tsx
```

The two nav-gating tests in `subscriptions.test.tsx` are not lost — they are rewritten against the tool model in Task 2, Step 1. The four page-rendering tests are carried over into `rc-pages.test.tsx` in Step 1 above.

- [ ] **Step 8: Run the tests**

Run: `cd dashboard && npx vitest run src/features/revenuecat/components/rc-pages.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 9: Verify the whole suite and the build**

Run: `cd dashboard && npm test && npm run build`
Expected: PASS. The sidebar still links to `/subscriptions`, which now redirects to `/rc/overview` — so `app-layout.test.tsx` and `keyboard-shortcuts.test.tsx` are unaffected.

- [ ] **Step 10: Commit**

```bash
git add dashboard/src/features/revenuecat/components dashboard/src/router.tsx
git commit -m "feat(dashboard): split Subscriptions into RC Overview + Conversion under /rc/*"
```

---

### Task 2: Tool dimension in the nav model

Turns `projectGroups()` into a `TOOLS` array with two accessors, and points all three consumers at them. The sidebar becomes tool-aware but stays visually one column — the rail arrives in Task 3.

**Files:**
- Modify: `dashboard/src/components/layout/nav-model.ts`
- Modify: `dashboard/src/components/layout/NavIcon.tsx`
- Modify: `dashboard/src/components/layout/AppLayout.tsx:140-161`
- Modify: `dashboard/src/features/command-palette/CommandPalette.tsx:137-145`
- Modify: `dashboard/src/features/shortcuts/keyboard-shortcuts.ts:3,40-45`
- Test: `dashboard/src/components/layout/nav-model.test.ts` (new)

**Interfaces:**
- Consumes: `IconName` from `./NavIcon`.
- Produces:
  - `type ToolId = 'amplitude' | 'revenuecat'`
  - `interface Tool { id: ToolId; label: string; icon: IconName; home: string; groups: NavGroup[] }`
  - `const TOOLS: Tool[]`
  - `function toolGroups(toolId: ToolId, opts?: { rcEnabled?: boolean }): NavGroup[]`
  - `function allGroups(opts?: { rcEnabled?: boolean }): NavGroup[]`
  - `function toolForPathname(pathname: string): ToolId`
  - `projectGroups()` is **removed**.

**Critical:** `opts` must be optional on both accessors. `keyboard-shortcuts.ts` calls `allGroups()` at module scope where no `rcEnabled` exists. Omitting `opts` returns every page ungated — which is correct there, because no RC page has a shortcut letter.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/components/layout/nav-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOOLS, allGroups, toolForPathname, toolGroups } from './nav-model';

const labels = (groups: ReturnType<typeof allGroups>) => groups.flatMap((g) => g.items).map((i) => i.label);

describe('nav-model tools', () => {
  it('exposes MyAmplitude and MyRevenueCat', () => {
    expect(TOOLS.map((t) => t.id)).toEqual(['amplitude', 'revenuecat']);
    expect(TOOLS.map((t) => t.label)).toEqual(['MyAmplitude', 'MyRevenueCat']);
  });

  it('keeps Revenue in MyAmplitude — it reads SDK purchase events, not RevenueCat data', () => {
    expect(labels(toolGroups('amplitude', { rcEnabled: true }))).toContain('Revenue');
    expect(labels(toolGroups('revenuecat', { rcEnabled: true }))).not.toContain('Revenue');
  });

  it('surfaces the previously unreachable Flows route under Explore', () => {
    const explore = toolGroups('amplitude', { rcEnabled: true }).find((g) => g.heading === 'Explore');
    expect(explore?.items.map((i) => i.label)).toContain('Flows');
  });

  it('gates RC data pages on rcEnabled but never Integration settings', () => {
    const off = labels(toolGroups('revenuecat', { rcEnabled: false }));
    expect(off).not.toContain('Overview');
    expect(off).not.toContain('Customers');
    expect(off).toContain('Integration settings');

    const on = labels(toolGroups('revenuecat', { rcEnabled: true }));
    expect(on).toContain('Overview');
    expect(on).toContain('Conversion');
  });

  it('allGroups spans both tools; toolGroups spans exactly one', () => {
    const all = labels(allGroups({ rcEnabled: true }));
    expect(all).toContain('Insights');
    expect(all).toContain('Overview');
    expect(labels(toolGroups('amplitude', { rcEnabled: true }))).not.toContain('Overview');
  });

  it('allGroups() with no options returns every page ungated (module-scope caller)', () => {
    expect(labels(allGroups())).toContain('Overview');
  });

  it('derives the active tool from the pathname', () => {
    expect(toolForPathname('/projects/abc/insights')).toBe('amplitude');
    expect(toolForPathname('/projects/abc/rc/overview')).toBe('revenuecat');
    expect(toolForPathname('/projects')).toBe('amplitude');
  });

  it('every lettered shortcut label still resolves — NAV_SHORTCUT_LETTERS is silently lossy', () => {
    const all = labels(allGroups());
    for (const label of ['Home', 'Insights', 'Funnels', 'Retention', 'Users', 'Dashboards', 'Revenue']) {
      expect(all).toContain(label);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npx vitest run src/components/layout/nav-model.test.ts`
Expected: FAIL — `TOOLS`, `toolGroups`, `allGroups`, `toolForPathname` are not exported from `nav-model.ts`.

- [ ] **Step 3: Add the new icon names**

In `dashboard/src/components/layout/NavIcon.tsx`, add to the lucide import list (keep it alphabetical): `BadgeCheck`, `ChartPie`, `Contact`, `Layers`, `Package`, `PanelTop`, `Sparkles`, `Target`.

Add to the `IconName` union, after `'settings'`:

```ts
  | 'tool-amplitude'
  | 'tool-revenuecat'
  | 'overview'
  | 'charts'
  | 'customers'
  | 'products'
  | 'entitlements'
  | 'offerings'
  | 'paywalls'
  | 'conversion'
  | 'flows';
```

Add to the `ICONS` record:

```ts
  'tool-amplitude': ChartLine,
  'tool-revenuecat': Sparkles,
  overview: ChartPie,
  charts: ChartPie,
  customers: Contact,
  products: Package,
  entitlements: BadgeCheck,
  offerings: Layers,
  paywalls: PanelTop,
  conversion: Target,
  flows: GitBranch,
```

`Record<IconName, LucideIcon>` makes this exhaustive — a missing entry is a compile error.

- [ ] **Step 4: Rewrite `nav-model.ts`**

Replace the file body from `export function projectGroups()` onward. Keep `NavItem`, `NavAccent`, and `NavGroup` exactly as they are.

```ts
/** The tools the dashboard hosts. MyAmpix recreates Amplitude; MyRevenueCat mirrors RevenueCat. */
export type ToolId = 'amplitude' | 'revenuecat';

export interface Tool {
  id: ToolId;
  label: string;
  icon: IconName;
  /** Route pattern for the tool's landing page — where its rail button navigates. */
  home: string;
  groups: NavGroup[];
}

const p = (path: string) => `/projects/$projectId${path}`;

/**
 * Every page in the product, grouped by tool then by section. Single source of truth for "what
 * pages exist and where do they link": consumed by the sidebar (`AppLayout`), the tool rail, the
 * command palette's "Pages" section, and the `g <letter>` shortcuts — so they never drift apart.
 *
 * Adding a tool is one entry here. Note `router.tsx` remains the real source of truth for what
 * *resolves*; this is a hand-maintained mirror of it.
 */
export const TOOLS: Tool[] = [
  {
    id: 'amplitude',
    label: 'MyAmplitude',
    icon: 'tool-amplitude',
    home: p('/home'),
    groups: [
      {
        items: [{ label: 'Home', to: p('/home'), icon: 'home' }],
        accent: 'violet',
      },
      {
        heading: 'Explore',
        accent: 'cyan',
        items: [
          { label: 'Insights', to: p('/insights'), icon: 'insights' },
          { label: 'Funnels', to: p('/funnels'), icon: 'funnel' },
          { label: 'Flows', to: p('/flows'), icon: 'flows' },
          { label: 'Retention', to: p('/retention'), icon: 'retention' },
          // "Paths" is the interactive user-path map + Mermaid view (screen-paths, §19).
          { label: 'Paths', to: p('/paths'), icon: 'paths' },
          { label: 'Heatmap', to: p('/heatmap'), icon: 'heatmap' },
          // Revenue reads the SDK's own `$in_app_purchase` events — NOT RevenueCat data. It works
          // with no RevenueCat account, which is why it lives here and not under MyRevenueCat.
          { label: 'Revenue', to: p('/revenue'), icon: 'revenue' },
          { label: 'Distributions', to: p('/distributions'), icon: 'distributions' },
          { label: 'Properties', to: p('/properties'), icon: 'properties' },
          { label: 'Events', to: p('/events'), icon: 'events' },
        ],
      },
      {
        heading: 'Audience',
        accent: 'pink',
        items: [
          { label: 'Cohorts', to: p('/cohorts'), icon: 'cohorts' },
          { label: 'Users', to: p('/users'), icon: 'users' },
          { label: 'Sessions', to: p('/sessions'), icon: 'sessions' },
          { label: 'Live', to: p('/live'), icon: 'live' },
        ],
      },
      {
        heading: 'Saved',
        accent: 'amber',
        items: [
          { label: 'Dashboards', to: p('/dashboards'), icon: 'dashboards' },
          { label: 'Reports', to: p('/reports'), icon: 'reports' },
          { label: 'Templates', to: p('/templates'), icon: 'templates' },
        ],
      },
      {
        items: [{ label: 'Project settings', to: p(''), icon: 'settings', exact: true }],
        accent: 'lime',
      },
    ],
  },
  {
    id: 'revenuecat',
    label: 'MyRevenueCat',
    icon: 'tool-revenuecat',
    home: p('/rc/overview'),
    groups: [
      {
        heading: 'Monitor',
        accent: 'lime',
        items: [
          { label: 'Overview', to: p('/rc/overview'), icon: 'overview' },
          { label: 'Charts', to: p('/rc/charts'), icon: 'charts' },
          { label: 'Customers', to: p('/rc/customers'), icon: 'customers' },
        ],
      },
      {
        heading: 'Monetize',
        accent: 'amber',
        items: [
          { label: 'Products', to: p('/rc/products'), icon: 'products' },
          { label: 'Entitlements', to: p('/rc/entitlements'), icon: 'entitlements' },
          { label: 'Offerings', to: p('/rc/offerings'), icon: 'offerings' },
          { label: 'Paywalls', to: p('/rc/paywalls'), icon: 'paywalls' },
        ],
      },
      {
        heading: 'Analyze',
        accent: 'cyan',
        items: [
          // Correlates RC events against the SDK's event stream — a MyAmpix capability, not
          // something real RevenueCat can do. Hence its own group rather than mirroring RC's IA.
          { label: 'Conversion', to: p('/rc/conversion'), icon: 'conversion' },
        ],
      },
      {
        // Its own route rather than a link to project settings: the active tool is derived from
        // the pathname, so pointing this at /projects/$projectId would eject you from
        // MyRevenueCat the moment you clicked the one item whose job is configuring it.
        items: [{ label: 'Integration settings', to: p('/rc/settings'), icon: 'settings' }],
        accent: 'violet',
      },
    ],
  },
];

/** Pages that only mean anything once RevenueCat is connected. Integration settings is how you
 * connect, so it is never gated. */
const RC_GATED = new Set(['Overview', 'Charts', 'Customers', 'Products', 'Entitlements', 'Offerings', 'Paywalls', 'Conversion']);

export interface NavOptions {
  /** When false, RevenueCat's data pages are dropped. Omit to return everything ungated. */
  rcEnabled?: boolean;
}

/**
 * Scoped to the revenuecat tool deliberately: `RC_GATED` matches on labels, so applying it across
 * every tool would silently hide a future MyAmplitude page that happened to be called "Charts".
 */
function gate(groups: NavGroup[], toolId: ToolId, opts?: NavOptions): NavGroup[] {
  if (toolId !== 'revenuecat' || opts?.rcEnabled !== false) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !RC_GATED.has(item.label)) }))
    .filter((group) => group.items.length > 0);
}

/** One tool's groups, for the sidebar. */
export function toolGroups(toolId: ToolId, opts?: NavOptions): NavGroup[] {
  const tool = TOOLS.find((t) => t.id === toolId);
  return tool ? gate(tool.groups, tool.id, opts) : [];
}

/**
 * Every tool's groups, flattened. The command palette stays cross-tool on purpose — its whole
 * value is jumping to *anything* — and the `g <letter>` shortcuts read it at module scope with no
 * options, which is why `opts` is optional.
 */
export function allGroups(opts?: NavOptions): NavGroup[] {
  return TOOLS.flatMap((tool) => gate(tool.groups, tool.id, opts));
}

/** The active tool, derived from the URL — never stored. */
export function toolForPathname(pathname: string): ToolId {
  return pathname.includes('/rc/') ? 'revenuecat' : 'amplitude';
}
```

- [ ] **Step 5: Run the nav-model tests**

Run: `cd dashboard && npx vitest run src/components/layout/nav-model.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Point AppLayout at the tool accessors**

In `dashboard/src/components/layout/AppLayout.tsx`, change the import on line 19:

```tsx
import { toolForPathname, toolGroups, type NavAccent, type NavItem } from './nav-model';
```

`pathname` is currently read on line 151, *after* `groups`. Move that `useRouterState` call above the `rcEnabled` line, then replace the `groups` memo (lines 141-150) with:

```tsx
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rcEnabled = useRcEnabled(projectId);
  const activeTool = toolForPathname(pathname);
  const groups = useMemo(
    () => (projectId ? toolGroups(activeTool, { rcEnabled }) : []),
    [projectId, activeTool, rcEnabled],
  );
```

Then delete the now-duplicated `const pathname = useRouterState(...)` on old line 151.

**Note the dep array gains `activeTool`.** Without it the sidebar silently keeps the previous tool's pages after a switch.

- [ ] **Step 7: Point CommandPalette at `allGroups`**

In `dashboard/src/features/command-palette/CommandPalette.tsx`, change the line 8 import to:

```tsx
import { allGroups } from '../../components/layout/nav-model';
```

Replace the `navGroups` memo (lines 137-145) with:

```tsx
  const rcEnabled = useRcEnabled(projectId);
  // Cross-tool on purpose: the palette's value is jumping to anything, so it is never scoped to
  // the active tool.
  const navGroups = useMemo(() => allGroups({ rcEnabled }), [rcEnabled]);
```

- [ ] **Step 8: Point keyboard-shortcuts at `allGroups`**

In `dashboard/src/features/shortcuts/keyboard-shortcuts.ts`, change line 3 to:

```ts
import { allGroups } from '../../components/layout/nav-model';
```

and line 40 to:

```ts
export const SHORTCUT_ROUTES: ShortcutRoute[] = allGroups()
```

Leave lines 41-45 exactly as they are. `SHORTCUT_ROUTES` stays a module-level const and `ShortcutsHelp.tsx` is untouched — every lettered label points at a MyAmplitude page, and no RC page has a letter.

- [ ] **Step 9: Rewrite the RC nav-gating tests**

Create `dashboard/src/features/revenuecat/components/rc-nav.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  VALID_ACCESS_TOKEN,
  TEST_USER,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

describe('MyRevenueCat nav gating', () => {
  it('lists the RC data pages in the sidebar when RC is connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Overview')).toBeInTheDocument();
    expect(nav.getByText('Conversion')).toBeInTheDocument();
    expect(nav.getByText('Customers')).toBeInTheDocument();
  });

  it('drops the RC data pages but keeps Integration settings when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    await waitFor(() => expect(nav.queryByText('Overview')).not.toBeInTheDocument());
    expect(nav.getByText('Integration settings')).toBeInTheDocument();
  });

  it('shows MyAmplitude pages, not RC pages, on an analytics route', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Insights')).toBeInTheDocument();
    expect(nav.queryByText('Overview')).not.toBeInTheDocument();
  });
});
```

The palette's cross-tool reach is covered by the `allGroups` unit test in
`nav-model.test.ts` — do not add a rendering test that merely re-asserts the model.

- [ ] **Step 10: Run the full suite and build**

Run: `cd dashboard && npm test && npm run build`
Expected: PASS. `app-layout.test.tsx` still passes — Home/Funnels/Paths/Templates and the Explore/Audience/Saved headings are all MyAmplitude pages inside the `Primary` nav, and Insights still maps to cyan.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/components/layout/nav-model.ts dashboard/src/components/layout/nav-model.test.ts dashboard/src/components/layout/NavIcon.tsx dashboard/src/components/layout/AppLayout.tsx dashboard/src/features/command-palette/CommandPalette.tsx dashboard/src/features/shortcuts/keyboard-shortcuts.ts dashboard/src/features/revenuecat/components/rc-nav.test.tsx
git commit -m "feat(dashboard): add tool dimension to the nav model"
```

---

### Task 3: The tool rail

Adds the second column. The rail renders the wordmark and one button per tool; the existing sidebar becomes the section list beside it.

**Files:**
- Create: `dashboard/src/components/layout/ToolRail.tsx`
- Modify: `dashboard/src/components/layout/AppLayout.tsx:163-205`
- Modify: `dashboard/src/index.css` (add `--rail-w`)
- Test: `dashboard/src/components/layout/tool-rail.test.tsx` (new)

**Interfaces:**
- Consumes: `TOOLS`, `type ToolId` from `./nav-model`; `NavIcon` from `./NavIcon`.
- Produces: `ToolRail({ activeTool, projectId }: { activeTool: ToolId; projectId?: string })`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/components/layout/tool-rail.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render-app';
import { TEST_PROJECT, VALID_ACCESS_TOKEN, TEST_USER } from '../../test/msw/handlers';
import { authStore } from '../../features/auth/store';

describe('ToolRail', () => {
  it('renders one link per tool, in its own Tools nav', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    expect(rail.getByRole('link', { name: 'MyAmplitude' })).toBeInTheDocument();
    expect(rail.getByRole('link', { name: 'MyRevenueCat' })).toBeInTheDocument();
  });

  it('marks the active tool', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    expect(rail.getByRole('link', { name: 'MyRevenueCat' })).toHaveAttribute('aria-current', 'page');
    expect(rail.getByRole('link', { name: 'MyAmplitude' })).not.toHaveAttribute('aria-current');
  });

  it('navigates to the tool home and swaps the section list', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));

    await userEvent.click(rail.getByRole('link', { name: 'MyRevenueCat' }));

    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Overview')).toBeInTheDocument();
    expect(nav.queryByText('Insights')).not.toBeInTheDocument();
  });

  it('shows the MyRevenueCat button even when RC is not connected — discoverability', async () => {
    const { projectsHandlerWithoutRc } = await import('../../test/msw/handlers');
    const { server } = await import('../../test/msw/server');
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    expect(rail.getByRole('link', { name: 'MyRevenueCat' })).toBeInTheDocument();
  });

  it('hides the tool buttons with no project selected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('navigation', { name: 'Tools' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/components/layout/tool-rail.test.tsx`
Expected: FAIL — no `navigation` element named `Tools` exists.

- [ ] **Step 3: Add the rail width token**

In `dashboard/src/index.css`, inside the `:root` block (alongside the accent vars around line 22), add:

```css
  /* Tool rail width. The section list beside it stays the hardcoded w-60 it has always been. */
  --rail-w: 4.5rem;
```

- [ ] **Step 4: Create `ToolRail`**

Create `dashboard/src/components/layout/ToolRail.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/cn';
import { NavIcon } from './NavIcon';
import { TOOLS, type ToolId } from './nav-model';

const TOOL_LINK_BASE =
  'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text';
const TOOL_LINK_ACTIVE = 'bg-accent-soft text-accent';

/**
 * The tool switcher: one button per product surface (MyAmplitude, MyRevenueCat). Adding a tool is
 * one entry in `TOOLS` — nothing here is per-tool.
 *
 * Deliberately always renders every tool, including ones the project hasn't connected: hiding
 * MyRevenueCat until RevenueCat is set up makes the feature undiscoverable to exactly the people
 * who haven't adopted it. An unconnected tool's home route explains how to connect instead.
 */
export function ToolRail({ activeTool, projectId }: { activeTool: ToolId; projectId?: string }) {
  // Tools are project-scoped; off a project route there is nothing to switch between.
  if (!projectId) return null;

  return (
    <nav aria-label="Tools" className="flex flex-col gap-1">
      {TOOLS.map((tool) => {
        const active = tool.id === activeTool;
        return (
          <Link
            key={tool.id}
            to={tool.home}
            params={{ projectId }}
            className={cn(TOOL_LINK_BASE, active && TOOL_LINK_ACTIVE)}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon name={tool.icon} />
            <span className="w-full truncate text-center leading-tight">{tool.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

The accessible name comes from the visible `{tool.label}` text, so `getByRole('link', { name: 'MyAmplitude' })` resolves with no `aria-label` needed.

- [ ] **Step 5: Restructure AppLayout into two columns**

In `dashboard/src/components/layout/AppLayout.tsx`, add to the imports:

```tsx
import { ToolRail } from './ToolRail';
```

Wrap the existing `<aside>` in a flex row and put the rail first. Replace the opening of the `<aside>` block (line 187-198) with:

```tsx
      <div
        id="app-sidebar"
        className={cn(
          'z-40 flex shrink-0',
          'md:sticky md:top-0 md:h-screen',
          mobileOpen ? 'fixed inset-y-0 left-0 flex' : 'hidden md:flex',
        )}
      >
        {/* Global column: brand + tools + identity. Project-scoped chrome lives in the aside. */}
        <div
          className="flex shrink-0 flex-col items-center gap-2 border-r border-border bg-surface p-2"
          style={{ width: 'var(--rail-w)' }}
        >
          <span className="py-2 font-display text-lg font-bold text-gradient-brand">M</span>
          <ToolRail activeTool={activeTool} projectId={projectId} />
        </div>

        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex shrink-0 flex-col gap-3 p-4">
          <OrgSwitcher />
          <ProjectSwitcher />
          {/* Project-scoped: reports/dashboards/cohorts/users only resolve once a project is picked. */}
          {projectId && <CommandPalette projectId={projectId} />}
        </div>
```

The `MyAmpix` wordmark `<div className="hidden md:block">` that used to sit at the top of the aside is removed — the `M` monogram in the rail replaces it. The mobile top bar's wordmark (line 174) stays.

Change the `</aside>` closing tag (line 260) to:

```tsx
        </aside>
      </div>
```

- [ ] **Step 6: Run the rail tests**

Run: `cd dashboard && npx vitest run src/components/layout/tool-rail.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 7: Run the full suite and build**

Run: `cd dashboard && npm test && npm run build`
Expected: PASS. `app-layout.test.tsx` is unaffected — the bottom cluster has not moved yet, and the `Primary` nav still contains the same MyAmplitude links and headings.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/components/layout/ToolRail.tsx dashboard/src/components/layout/tool-rail.test.tsx dashboard/src/components/layout/AppLayout.tsx dashboard/src/index.css
git commit -m "feat(dashboard): add the tool rail beside the section list"
```

---

### Task 4: Move identity chrome into the rail

Moves the bottom cluster (email, Account, Organization settings, Log out) into a rail avatar popover and the theme toggle into a rail icon button. **This is the only task that intentionally breaks existing tests** — it turns three directly-clickable controls into two-step interactions.

**Files:**
- Create: `dashboard/src/components/layout/RailIdentityMenu.tsx`
- Modify: `dashboard/src/components/layout/ThemeToggle.tsx`
- Modify: `dashboard/src/components/layout/AppLayout.tsx:231-259`
- Modify: `dashboard/src/components/layout/app-layout.test.tsx:19-42,104-147`

**Interfaces:**
- Consumes: `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuTrigger` from `../ui/dropdown-menu`; `useAuth` from `../../features/auth/store`.
- Produces: `RailIdentityMenu({ email, orgId, onLogout }: { email?: string; orgId: string | null; onLogout: () => void })`; `ThemeToggle({ compact }: { compact?: boolean })`.

**Accessible names must not change:** `Switch to dark mode` / `Switch to light mode`, `Organization settings`, `Account`, `Log out`. Only their *location* changes.

- [ ] **Step 1: Update the failing tests first**

In `dashboard/src/components/layout/app-layout.test.tsx`, replace the test at lines 19-42 with:

```tsx
  it('shows navigation, the workspace + project selectors, and the signed-in user', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();

    // The project selector is a real, enabled dropdown (no more disabled "All projects" box).
    const projectSelector = screen.getByRole('button', { name: 'Switch project' });
    expect(projectSelector).toBeEnabled();
    expect(within(projectSelector).getByText('All projects')).toBeInTheDocument();

    // The signed-in user now lives behind the rail's identity menu.
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText(TEST_USER.email)).toBeInTheDocument();
  });

  it('places Organization settings in the rail identity menu as a nav item', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));

    const link = await screen.findByRole('link', { name: 'Organization settings' });
    expect(link).toHaveAttribute('href', `/orgs/${TEST_ORG_ID}/settings`);
  });
```

Replace both logout tests' click line (lines 122 and 142) — in each, replace:

```tsx
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
```

with:

```tsx
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));
```

The theme-toggle test at line 104 needs no change — the accessible name is preserved.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npx vitest run src/components/layout/app-layout.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Account menu"`.

- [ ] **Step 3: Give `ThemeToggle` a compact mode**

In `dashboard/src/components/layout/ThemeToggle.tsx`, replace the component:

```tsx
export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(compact ? 'w-auto px-2' : 'w-full justify-start')}
      onClick={toggleTheme}
      aria-pressed={isDark}
      // In compact mode the label is dropped for space, so it has to carry the accessible name.
      aria-label={compact ? label : undefined}
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
        <Sun
          aria-hidden="true"
          className={cn(
            'absolute size-4 transition-all duration-150',
            isDark ? 'rotate-90 opacity-0' : 'rotate-0 opacity-100',
          )}
        />
        <Moon
          aria-hidden="true"
          className={cn(
            'absolute size-4 transition-all duration-150',
            isDark ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0',
          )}
        />
      </span>
      {!compact && label}
    </Button>
  );
}
```

- [ ] **Step 4: Create `RailIdentityMenu`**

Create `dashboard/src/components/layout/RailIdentityMenu.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { NavIcon } from './NavIcon';

/**
 * The rail's identity cluster. The rail is too narrow for the text links this replaced, so the
 * signed-in email, Account, Organization settings, and Log out collapse into one popover — the
 * standard pattern for a narrow rail. Accessible names are unchanged from when these were direct
 * links, only their location moved.
 */
export function RailIdentityMenu({
  email,
  orgId,
  onLogout,
}: {
  email?: string;
  orgId: string | null;
  onLogout: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-auto px-2" aria-label="Account menu">
          <NavIcon name="account" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        {email && <DropdownMenuLabel className="truncate font-normal text-text-muted">{email}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">Account</Link>
        </DropdownMenuItem>
        {orgId && (
          <DropdownMenuItem asChild>
            <Link to="/orgs/$orgId/settings" params={{ orgId }}>
              Organization settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: Move the cluster in AppLayout**

In `dashboard/src/components/layout/AppLayout.tsx`, add the import:

```tsx
import { RailIdentityMenu } from './RailIdentityMenu';
```

Replace the whole bottom cluster block (lines 231-259, `<div className="mt-auto shrink-0 space-y-1 border-t border-border p-4">…</div>`) with just the shortcuts hint, kept in the section list where there is room for it:

```tsx
        <div className="mt-auto shrink-0 border-t border-border p-4">
          {/* Subtle, always-available affordance for the shortcut system (feat-12). */}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="w-full truncate px-3 text-left text-xs text-text-muted/70 transition-colors hover:text-text-muted"
          >
            Press <Kbd>?</Kbd> for shortcuts
          </button>
        </div>
```

In the rail column created in Task 3, add the identity cluster below the `ToolRail`:

```tsx
          <span className="py-2 font-display text-lg font-bold text-gradient-brand">M</span>
          <ToolRail activeTool={activeTool} projectId={projectId} />
          <div className="mt-auto flex flex-col items-center gap-1">
            <ThemeToggle compact />
            <RailIdentityMenu email={user?.email} orgId={currentOrgId} onLogout={() => void handleLogout()} />
          </div>
```

Remove the now-unused `SidebarLink` usages for `Organization settings` and `Account`, and drop the `Button` import if nothing else in the file uses it (the mobile menu toggle still does — keep it).

- [ ] **Step 6: Run the layout tests**

Run: `cd dashboard && npx vitest run src/components/layout/app-layout.test.tsx`
Expected: PASS — 10 tests.

- [ ] **Step 7: Run the full suite and build**

Run: `cd dashboard && npm test && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/components/layout/RailIdentityMenu.tsx dashboard/src/components/layout/ThemeToggle.tsx dashboard/src/components/layout/AppLayout.tsx dashboard/src/components/layout/app-layout.test.tsx
git commit -m "feat(dashboard): move identity chrome into the tool rail"
```

---

### Task 5: The connect screen

Replaces the generic "Connect RevenueCat in project settings" empty state with a real connect surface at MyRevenueCat's home, reusing the existing `ConnectForm` rather than duplicating it.

**Files:**
- Create: `dashboard/src/features/revenuecat/components/RcConnectPage.tsx`
- Modify: `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx` (`!rcEnabled` branch)
- Test: `dashboard/src/features/revenuecat/components/rc-connect.test.tsx` (new)

**Interfaces:**
- Consumes: `IntegrationsSection` from `../../projects/components/IntegrationsSection` (already exported); `useProjectRole` from `../../projects/api`.
- Produces: `RcConnectPage()`.

**`IntegrationsSection` needs no change.** It is already exported, already owns its `useRcStatus` call, and already renders `ConnectForm` when disconnected. Reuse it whole — do not export `ConnectForm` separately, and do not restructure that file.

**Non-admins cannot connect** (`ProjectDetailPage.tsx:101` gates the section on `project && isAdmin`). Show them an explanation, not a form that will 403.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/features/revenuecat/components/rc-connect.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  VALID_ACCESS_TOKEN,
  TEST_USER,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

describe('RcConnectPage', () => {
  it('offers the connect form on an unconnected project', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(main.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('shows the overview, not the connect screen, once connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('MRR')).toBeInTheDocument();
    expect(main.queryByRole('heading', { name: /connect revenuecat/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/features/revenuecat/components/rc-connect.test.tsx`
Expected: FAIL — the unconnected project renders the `EmptyState` from Task 1, which has no `Connect` button.

- [ ] **Step 3: Create `RcConnectPage`**

Create `dashboard/src/features/revenuecat/components/RcConnectPage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationsSection } from '../../projects/components/IntegrationsSection';
import { useProjectRole } from '../../projects/api';

/**
 * MyRevenueCat's landing page for a project that hasn't connected RevenueCat. The tool's rail
 * button is always visible, so this is what an unconnected project sees instead of empty charts —
 * it doubles as the upsell and the setup path.
 *
 * Reuses `IntegrationsSection` (which renders the connect form off its own `useRcStatus`) so there
 * is exactly one connect flow, shared with project settings and `RcSettingsPage`.
 */
export function RcConnectPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/overview' });
  const role = useProjectRole(projectId);
  const isAdmin = role === 'admin' || role === 'owner';

  return (
    <PageShell
      projectId={projectId}
      title="Connect RevenueCat"
      description="Bring your subscription data in to see MRR, churn, and customers."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Connect' }]}
    >
      {isAdmin ? (
        <IntegrationsSection projectId={projectId} />
      ) : (
        <EmptyState
          title="Ask an admin to connect RevenueCat"
          description="Only project admins can connect integrations. Once RevenueCat is connected, subscription analytics appear here."
        />
      )}
    </PageShell>
  );
}
```

- [ ] **Step 4: Use it from `RcOverviewPage`**

In `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx`, replace the whole `if (!rcEnabled) { ... }` block with:

```tsx
  if (!rcEnabled) return <RcConnectPage />;
```

Add `import { RcConnectPage } from './RcConnectPage';` and drop the now-unused `EmptyState` import if nothing else in the file uses it.

Leave `RcConversionPage`'s `EmptyState` branch as it is — Overview is the tool's home and the only page that needs to teach setup; Conversion is reached only from the nav, which already hides it when disconnected.

- [ ] **Step 5: Run the connect tests**

Run: `cd dashboard && npx vitest run src/features/revenuecat/components/rc-connect.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 6: Reconcile the Task 1 overview test**

The `shows an upsell empty state when RC is not connected` test in `rc-pages.test.tsx` now hits the connect screen. Update its assertion to:

```tsx
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
```

- [ ] **Step 7: Run the full suite and build**

Run: `cd dashboard && npm test && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/features/revenuecat/components
git commit -m "feat(dashboard): land unconnected projects on an RC connect screen"
```

---

### Task 6: Verify the whole feature end-to-end

Tests are not the same as the app working. Drive it.

- [ ] **Step 1: Start the app**

Run: `cd /Users/aimeric/Documents/personnal-project/MyAmpix && pnpm infra:up && ./scripts/dev.sh`
Expected: backend on `:8088`, dashboard on `:5173`.

- [ ] **Step 2: Walk the rail**

Open `http://localhost:5173`, sign in, open a project, and confirm by observation:

1. The rail shows `M`, MyAmplitude, MyRevenueCat; the active tool is tinted.
2. Clicking MyRevenueCat lands on `/rc/overview` and the section list swaps to Monitor / Monetize / Analyze.
3. Clicking MyAmplitude returns to `/home` with Explore / Audience / Saved.
4. `Flows` appears under Explore and resolves.
5. A placeholder (`/rc/customers`) renders its not-built-yet state, not a 404.
6. Visiting `/projects/<id>/subscriptions` redirects to `/rc/overview`.
7. Clicking `Integration settings` **stays on MyRevenueCat** — the rail does not jump back to MyAmplitude — and shows the RevenueCat card.
8. The rail avatar menu opens and shows the email, Account, Organization settings, Log out.
9. The theme toggle still works from the rail.
10. `⌘K` finds "Overview" while MyAmplitude is active.
11. `g i` still jumps to Insights.
12. Narrow the window below `md`: the drawer opens and scrolls as one column.

- [ ] **Step 3: Confirm the accent still tracks**

On `/insights`, inspect `#main-content` — `data-accent="cyan"`. On `/rc/overview` — `data-accent="lime"`.

- [ ] **Step 4: Report**

State what was observed. If anything failed, fix it and re-run the suite before claiming completion.

---

## Deferred (do not build here)

- **The RC backend service extraction.** Decided in principle (separate NestJS app, shared Postgres + ClickHouse); see the spec's *Deferred decisions*.
- **The six placeholder pages** (Charts, Customers, Products, Entitlements, Offerings, Paywalls).
- **Reconciling Revenue vs Overview.** They read different sources in different units and will disagree on the same product IDs. Known and accepted.
- **`nav-model.ts` drifting from `router.tsx`.** Still hand-maintained.
- **`NAV_SHORTCUT_LETTERS` silently dropping renamed labels.** The nav-model test added in Task 2 Step 1 now catches this.
