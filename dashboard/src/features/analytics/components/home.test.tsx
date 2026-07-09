import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import type { InsightsQueryDefinition, InsightsSeries } from '../../../lib/api/types';
import {
  ENGAGEMENT_FIXTURE,
  SESSIONS_SUMMARY_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

afterEach(() => server.events.removeAllListeners());

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Decodes the metric endpoints' base64url `filters` query param (mirrors `encodeFiltersParam`). */
function decodeFiltersParam(raw: string): unknown {
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
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

    // Highlights strip: at least one plain-language, period-over-period call-out up top.
    const highlightsList = await main.findByRole('list', { name: 'Highlights' });
    expect(within(highlightsList).getAllByText(/vs previous period$/).length).toBeGreaterThan(0);

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
    // The Highlights strip has nothing to scan yet and renders nothing (doesn't crash).
    expect(main.queryByRole('list', { name: 'Highlights' })).not.toBeInTheDocument();
  });

  it('ranks a real period-over-period move above flat metrics in the Highlights strip', async () => {
    // The insights/engagement fixtures return identical values regardless of date range, so every
    // metric they drive is flat here — override sessions (keyed off the "current" `to` date) to
    // exercise a genuine move and prove it ranks first, in plain language, with the right tone.
    const todayStr = new Date().toISOString().slice(0, 10);
    server.use(
      http.get('/api/v1/projects/:projectId/sessions/summary', ({ request }) => {
        const isCurrent = new URL(request.url).searchParams.get('to') === todayStr;
        return HttpResponse.json({
          sessions: isCurrent ? 155 : 125, // +24%
          avg_duration_ms: 245000, // unchanged -> flat
          by_day: [
            { t: '2026-06-29', sessions: 40, avg_duration_ms: 230000 },
            { t: '2026-06-30', sessions: 44, avg_duration_ms: 250000 },
            { t: '2026-07-01', sessions: 44, avg_duration_ms: 255000 },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));
    const highlightsList = await main.findByRole('list', { name: 'Highlights' });
    const [firstItem] = within(highlightsList).getAllByRole('listitem');

    expect(firstItem).toHaveTextContent('Sessions up 24% vs previous period');
    expect(within(firstItem as HTMLElement).getByText('Sessions up 24% vs previous period')).toHaveClass(
      'text-accent',
    );
  });

  it('feat-02 §3.4/T2: sends the active global filter to the engagement/sessions KPIs, with no "unfiltered" note', async () => {
    localStorage.setItem(
      `myampix:globalfilters:${TEST_PROJECT.id}`,
      JSON.stringify([{ property: 'os', op: 'eq', value: 'ios' }]),
    );

    let engagementUrl: string | null = null;
    let sessionsUrl: string | null = null;
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/engagement', ({ request }) => {
        engagementUrl = request.url;
        return HttpResponse.json(ENGAGEMENT_FIXTURE);
      }),
      http.get('/api/v1/projects/:projectId/sessions/summary', ({ request }) => {
        sessionsUrl = request.url;
        return HttpResponse.json(SESSIONS_SUMMARY_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));
    await main.findByText('DAU');

    expect(engagementUrl).not.toBeNull();
    const engagementFilters = new URL(engagementUrl!).searchParams.get('filters');
    expect(engagementFilters).not.toBeNull();
    expect(decodeFiltersParam(engagementFilters!)).toEqual([{ property: 'os', op: 'eq', value: 'ios' }]);

    expect(sessionsUrl).not.toBeNull();
    const sessionsFilters = new URL(sessionsUrl!).searchParams.get('filters');
    expect(sessionsFilters).not.toBeNull();
    expect(decodeFiltersParam(sessionsFilters!)).toEqual([{ property: 'os', op: 'eq', value: 'ios' }]);

    // T1's muted "unfiltered" note is gone now that the KPIs honor the global filter (T2).
    expect(main.queryByText(/aren.t filtered yet/i)).not.toBeInTheDocument();
  });

  it('feat-03 §3.2: clicking an OS breakdown value adds the matching global filter, and clicking it again clears it', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));

    // Re-looked-up fresh each time (rather than cached) — toggling the filter changes the
    // by-OS insights query's key, so the chart's table element itself gets swapped for a new
    // node when the refetched data lands.
    const findOsTable = async () => {
      const osFigure = await main.findByRole('img', { name: 'Events by OS' });
      return within(osFigure.parentElement as HTMLElement).getByRole('table');
    };

    const osTableBefore = await findOsTable();
    await userEvent.click(within(osTableBefore).getByRole('button', { name: 'android' }));

    // The Global Filter Bar chip is the visible feedback that the drill-down landed.
    expect(
      await main.findByRole('button', { name: 'Remove filter os equals android' }),
    ).toBeInTheDocument();
    const osTableSelected = await findOsTable();
    expect(within(osTableSelected).getByRole('button', { name: 'android' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Clicking the now-active value again clears it (toggle) rather than leaving it stuck on.
    await userEvent.click(within(osTableSelected).getByRole('button', { name: 'android' }));
    expect(
      main.queryByRole('button', { name: 'Remove filter os equals android' }),
    ).not.toBeInTheDocument();
    const osTableCleared = await findOsTable();
    expect(within(osTableCleared).getByRole('button', { name: 'android' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('feat-08: adding a note via the Notes manager renders a labelled reference line on the active-users trend', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));
    const trendFigure = await main.findByRole('img', { name: 'Active users trend' });

    await userEvent.click(main.getByRole('button', { name: 'Notes' }));
    const panel = main.getByRole('region', { name: 'Chart annotations' });
    // The engagement fixture's DAU series includes 2026-06-30 — a note dated there falls within
    // this chart's own bucket dates and so renders a marker (feat-08 §3/§4).
    fireEvent.change(within(panel).getByLabelText('Note date'), {
      target: { value: '2026-06-30' },
    });
    await userEvent.type(within(panel).getByPlaceholderText('e.g. v1.4 release'), 'v1.4 release');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add note' }));

    expect(
      within(trendFigure).getByRole('img', { name: 'v1.4 release — 2026-06-30' }),
    ).toBeInTheDocument();
  });

  it('feat-13: a favorited report shows in the Favorites section, and unstarring removes it', async () => {
    localStorage.setItem(
      `myampix:favorites:${TEST_PROJECT.id}`,
      JSON.stringify([{ type: 'report', id: 'report-fav-1', name: 'Starred report' }]),
    );
    localStorage.setItem(
      `myampix:recents:${TEST_PROJECT.id}`,
      JSON.stringify([{ type: 'dashboard', id: 'dash-recent-1', name: 'Recently opened board' }]),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));

    const favoritesHeading = await main.findByRole('heading', { name: 'Favorites' });
    const favoritesSection = favoritesHeading.closest('.rounded-xl') as HTMLElement;
    expect(within(favoritesSection).getByRole('link', { name: 'Starred report' })).toBeInTheDocument();

    const recentsHeading = main.getByRole('heading', { name: 'Recently viewed' });
    const recentsSection = recentsHeading.closest('.rounded-xl') as HTMLElement;
    expect(
      within(recentsSection).getByRole('link', { name: 'Recently opened board' }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(favoritesSection).getByRole('button', { name: 'Favorite Starred report' }),
    );
    expect(
      within(favoritesSection).queryByRole('link', { name: 'Starred report' }),
    ).not.toBeInTheDocument();
    expect(within(favoritesSection).getByText(/Star a report/)).toBeInTheDocument();
  });

  it('feat-18 §3.4/T2: renders the Installations map, by-country table, and by-OS chart, posting the $app_open country-breakdown query', async () => {
    const countryQueryBodies: InsightsQueryDefinition[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'POST' || !request.url.includes('/query/insights')) return;
      void request
        .clone()
        .json()
        .then((body) => {
          const definition = body as InsightsQueryDefinition;
          if (definition.breakdown?.property === 'country') countryQueryBodies.push(definition);
        });
    });

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);
    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));

    // KPI tiles for the section.
    expect(await main.findByText('Total users')).toBeInTheDocument();
    expect(main.getByText('Countries')).toBeInTheDocument();

    // The map renders with an accessible name, fed the folded ISO-3 -> count data.
    expect(await main.findByRole('img', { name: 'Users by country' })).toBeInTheDocument();

    // The by-country DataTable (distinct from the map's own internal accessible table) lists the
    // resolved country names plus an Unknown row for the fixture's unresolvable breakdown value.
    const countryTable = main.getByRole('table', { name: 'Users by country' });
    expect(within(countryTable).getByText('United States of America')).toBeInTheDocument();
    expect(within(countryTable).getByText('France')).toBeInTheDocument();
    expect(within(countryTable).getByText('Unknown')).toBeInTheDocument();

    // The by-OS breakdown chart for the same $app_open event.
    expect(await main.findByRole('img', { name: 'Users by OS' })).toBeInTheDocument();

    // The country-breakdown query posted the exact $first_open + country-breakdown definition.
    await waitFor(() => expect(countryQueryBodies.length).toBeGreaterThan(0));
    const [countryQueryBody] = countryQueryBodies;
    expect(countryQueryBody?.events).toEqual([{ name: '$app_open', aggregation: 'unique_users' }]);
    expect(countryQueryBody?.breakdown).toEqual({ property: 'country' });
  });

  it('feat-18 §3.4/T2: shows a friendly empty-state message when no installs have a resolvable country, but still renders by-OS', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        const body = (await request.json()) as InsightsQueryDefinition;
        if (body.breakdown?.property === 'country') {
          return HttpResponse.json({ series: [] });
        }
        const buckets = ['2026-06-29', '2026-06-30', '2026-07-01'];
        const breakdownValues: (string | null)[] = body.breakdown ? ['ios', 'android'] : [null];
        const series: InsightsSeries[] = [];
        body.events.forEach((eventQuery, eventIndex) => {
          breakdownValues.forEach((breakdownValue, breakdownIndex) => {
            series.push({
              name: eventQuery.name,
              breakdown_value: breakdownValue,
              data: buckets.map((t, bucketIndex) => ({
                t,
                value: (eventIndex + 1) * 10 + breakdownIndex * 5 + bucketIndex,
              })),
            });
          });
        });
        return HttpResponse.json({ series });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);
    await screen.findByRole('heading', { name: 'Home' });
    const main = within(screen.getByRole('main'));

    expect(
      await main.findByText(/No users with a country yet/),
    ).toBeInTheDocument();
    expect(main.queryByRole('img', { name: 'Users by country' })).not.toBeInTheDocument();

    // The by-OS chart still has data and renders independently of the country empty state.
    expect(await main.findByRole('img', { name: 'Users by OS' })).toBeInTheDocument();
  });
});
