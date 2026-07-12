import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, VALID_ACCESS_TOKEN, TEST_USER, projectsHandlerWithoutRc } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const URL = `/projects/${TEST_PROJECT.id}/subscriptions`;

describe('SubscriptionsPage', () => {
  it('renders KPI tiles, trend, churn donut, and breakdown tables from the summary', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('MRR')).toBeInTheDocument();
    expect(main.getByText('$49.95')).toBeInTheDocument(); // 4995 cents from the fixture
    expect(main.getByText('Active subscribers')).toBeInTheDocument();
    expect(main.getByText(/churn reasons/i)).toBeInTheDocument();
    expect(main.getByText(/by product/i)).toBeInTheDocument();
  });

  it('shows the Subscriptions nav entry when RC is connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Subscriptions')).toBeInTheDocument();
  });

  it('hides the nav entry and shows an empty state when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(URL);
    const main = within(await screen.findByRole('main'));
    expect((await main.findAllByText(/connect revenuecat/i)).length).toBeGreaterThan(0);
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    await waitFor(() => expect(nav.queryByText('Subscriptions')).not.toBeInTheDocument());
  });
});
