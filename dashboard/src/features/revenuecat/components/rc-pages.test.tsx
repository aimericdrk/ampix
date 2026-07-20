import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
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
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
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

  // Same class of bug as RcOverviewPage/RcSettingsPage (see rc-connect.test.tsx): reading the RC
  // connection flag off a still-loading `useProjects()` must not be mistaken for "not connected".
  // Holds `/api/v1/projects` open with an infinite delay to inspect the loading window itself.
  it('never shows the "connect revenuecat" upsell for an RC-connected project, including while still loading', async () => {
    server.use(
      http.get('/api/v1/projects', async () => {
        await delay('infinite');
        return HttpResponse.json({ projects: [] });
      }),
    );
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(CONVERSION_URL);

    await screen.findByRole('heading', { name: 'Conversion' });
    // `queryAllByText` — the empty state's title AND description both contain "connect revenuecat",
    // so the singular `queryByText` throws on multiple matches instead of failing cleanly.
    expect(screen.queryAllByText(/connect revenuecat/i)).toHaveLength(0);
  });

  // Regression test: the disconnected branch used to render a stale EmptyState pointing at
  // project settings, which is wrong now that `/rc/settings` exists specifically so configuring
  // RevenueCat doesn't eject you from the tool. It must give the same connect surface as
  // RcOverviewPage instead.
  it('shows the same connect surface as RcOverviewPage when RC is not connected, not the old project-settings copy', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(CONVERSION_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(await main.findByRole('button', { name: /connect/i })).toBeInTheDocument();
    expect(main.queryByText(/project settings/i)).not.toBeInTheDocument();
  });

  // Regression test: `ChartCard`'s error branch has no live region, so a failed attribution fetch
  // used to be silent to screen readers (and rendered three identical error messages for sighted
  // users). This page must announce the failure at the page level, mirroring RcOverviewPage.
  it('announces attribution load failures at the page level, not just inside each chart', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/subscriptions/attribution', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal server error', status: 500 },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(CONVERSION_URL);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load conversion analytics/i);
    expect(screen.queryByText(/conversion drivers/i)).not.toBeInTheDocument();
  });
});

describe('RcPlaceholderPage', () => {
  it('renders a not-built-yet state for Paywalls (the remaining placeholder route)', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/paywalls`);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: 'Paywalls' })).toBeInTheDocument();
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

  // Regression test for a bug where `useProjectRole` resolves to `undefined` while `useProjects()`
  // is still in flight, which made `isAdmin` compute to `false` and briefly render "Only admins can
  // manage integrations" to every admin on every page load. Asserting only the final state (as the
  // test above does) doesn't catch this — `findByTestId` just waits out the swap. This test instead
  // holds `/api/v1/projects` open with an infinite delay so it can inspect the loading window itself.
  it('never shows the "only admins" empty state to an admin, including while still loading', async () => {
    server.use(
      http.get('/api/v1/projects', async () => {
        await delay('infinite');
        return HttpResponse.json({ projects: [] });
      }),
    );
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/settings`);

    // The page shell renders immediately (its title is static), while `useProjects()` hangs forever.
    await screen.findByRole('heading', { name: 'Integration settings' });
    expect(screen.queryByText(/only admins can manage integrations/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-integration-card')).not.toBeInTheDocument();
  });
});
