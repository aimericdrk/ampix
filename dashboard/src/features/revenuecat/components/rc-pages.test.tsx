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
