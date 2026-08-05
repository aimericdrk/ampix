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

describe('MyRevenueCat nav', () => {
  it('lists the RC clone pages in the sidebar', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Overview')).toBeInTheDocument();
    expect(nav.getByText('Conversion')).toBeInTheDocument();
    expect(nav.getByText('Customers')).toBeInTheDocument();
  });

  it('shows the RC clone pages (and Integration settings) even when RC is not connected — the self-hosted clone has no connect gate', async () => {
    // The clone reads mobile_purchase and never gates on a real RevenueCat connection; the data
    // pages appear regardless of the legacy `integrations.revenuecat` flag.
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Overview')).toBeInTheDocument();
    expect(nav.getByText('Customers')).toBeInTheDocument();
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
