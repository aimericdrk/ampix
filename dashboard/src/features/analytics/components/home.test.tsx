import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('HomePage', () => {
  it('shows a data-dense KPI row, trend, breakdowns, top events, and recent work', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    // Scope label lookups to the page content — the sidebar nav also has a "Sessions" link etc.
    const main = within(screen.getByRole('main'));

    // Global date-range control renders in the header, defaulting to Last 30 days.
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute('aria-checked', 'true');

    // KPI row: labels for every metric the plan calls for.
    for (const label of ['Top-5 events', 'DAU', 'WAU', 'MAU', 'Sessions', 'Avg. session', 'Stickiness']) {
      expect(await main.findByText(label)).toBeInTheDocument();
    }
    // At least one period-over-period delta chip renders (▲/▼ + a percent).
    expect(main.getAllByText(/^[+-]\d+%$/).length).toBeGreaterThan(0);

    // Active-users trend, with the previous-period overlay.
    expect(await main.findByRole('img', { name: 'Active users trend' })).toBeInTheDocument();

    // Events-by-type donut with a center total.
    expect(main.getByRole('img', { name: 'Events by type composition' })).toBeInTheDocument();

    // Top events table, sortable, with the fixture's two events.
    const topEvents = main.getByRole('table', { name: 'Top events by count' });
    expect(within(topEvents).getByText('checkout_completed')).toBeInTheDocument();
    expect(within(topEvents).getByText('product_viewed')).toBeInTheDocument();

    // OS + app-version breakdowns.
    expect(await main.findByRole('img', { name: 'Events by OS' })).toBeInTheDocument();
    expect(main.getByRole('img', { name: 'Events by app version' })).toBeInTheDocument();

    // Recent reports + dashboards from the seeds, each with a decorative thumbnail preview.
    expect(await main.findByRole('link', { name: 'Weekly checkouts' })).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'Signup funnel' })).toBeInTheDocument();
    expect(await main.findByRole('link', { name: 'Growth overview' })).toBeInTheDocument();
    expect(await main.findAllByTestId('chart-thumbnail')).not.toHaveLength(0);
  });

  it('shows a fresh-project empty state when there are no events', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/events/summary', ({ params }) =>
        HttpResponse.json({ project_id: params.projectId as string, total: 0, by_event: [] }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));
    expect(await main.findByText('No events yet')).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'View ingest token' })).toBeInTheDocument();

    // With no events, none of the data-dense sections draw.
    expect(main.queryByRole('img', { name: 'Events by type composition' })).not.toBeInTheDocument();
    expect(main.queryByRole('img', { name: 'Active users trend' })).not.toBeInTheDocument();
    expect(main.queryByText('DAU')).not.toBeInTheDocument();
  });
});
