import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { InsightsQueryDefinition } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { TEST_COHORT_ID } from '../../../test/msw/phase5-handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import { decodeAnalysisState, encodeAnalysisState } from '../share-state';
import { defaultDate } from './builder-controls';
import type { InsightsAnalysisState } from './InsightsPage';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** The default event (first in META_EVENTS_FIXTURE) is pre-selected on load — wait for its row. */
function waitForDefaultEvent() {
  return screen.findByLabelText('Measure for checkout_completed');
}

describe('InsightsPage', () => {
  it('auto-runs a sensible default on load and renders a chart with no Run button', async () => {
    let capturedBody: InsightsQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        capturedBody = (await request.json()) as InsightsQueryDefinition;
        return HttpResponse.json({
          series: [
            {
              name: 'checkout_completed',
              breakdown_value: null,
              data: [{ t: '2026-06-29', value: 5 }],
            },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    // A chart appears with no interaction — the builder pre-selected the first event and ran itself.
    await screen.findByRole('img', { name: 'Insights line chart' }, { timeout: 3000 });
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();

    expect(capturedBody?.events).toEqual([{ name: 'checkout_completed', aggregation: 'total' }]);
    expect(capturedBody?.interval).toBe('day');
    expect(capturedBody?.filters).toEqual([]);
    expect(capturedBody?.date_range).toEqual({ from: defaultDate(30), to: defaultDate(0) });
  });

  it('adds a series by picking a real event from the searchable dropdown (no typing a raw name)', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    const search = screen.getByRole('combobox', { name: 'Add event' });

    // The already-selected event is excluded; the list only offers events that actually exist.
    expect(screen.queryByRole('option', { name: 'checkout_completed' })).toBeNull();
    expect(screen.getByRole('option', { name: 'product_viewed' })).toBeInTheDocument();

    // Typing filters the real events — there is no way to invent a name.
    await userEvent.type(search, 'sign');
    expect(screen.queryByRole('option', { name: 'product_viewed' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'signup_completed' }));

    expect(await screen.findByLabelText('Measure for signup_completed')).toBeInTheDocument();
    // Picking closes the dropdown.
    expect(screen.queryByRole('option', { name: 'app_opened' })).toBeNull();
  });

  it('builds the §14 query from the plain-language + demoted controls (measure, group by, filter, custom range)', async () => {
    let capturedBody: InsightsQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        capturedBody = (await request.json()) as InsightsQueryDefinition;
        return HttpResponse.json({
          series: [
            {
              name: 'checkout_completed',
              breakdown_value: 'ios',
              data: [{ t: '2026-06-29', value: 5 }],
            },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    // Plain-language measure control ("Count" / "Unique users", never "aggregation").
    const measure = screen.getByLabelText('Measure for checkout_completed');
    expect(within(measure).getByRole('option', { name: 'Count' })).toBeInTheDocument();
    await userEvent.selectOptions(measure, 'Unique users');

    // Group by is demoted behind a "+ Group by" action until asked for.
    expect(screen.queryByLabelText('Group by')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Group by' }));
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'utm_source');

    // Filters are demoted too; revealing seeds one editable row.
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.selectOptions(screen.getByLabelText('Filter property 1'), 'app_version');
    await userEvent.selectOptions(screen.getByLabelText('Filter operator 1'), 'eq');
    await userEvent.type(screen.getByLabelText('Filter value 1'), 'ios');

    // "Custom" reveals the exact from/to inputs.
    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-29' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-30' } });

    await waitFor(
      () =>
        expect(capturedBody).toEqual({
          events: [{ name: 'checkout_completed', aggregation: 'unique_users' }],
          date_range: { from: '2026-06-29', to: '2026-06-30' },
          interval: 'day',
          filters: [{ property: 'app_version', op: 'eq', value: 'ios' }],
          breakdown: { property: 'utm_source' },
        }),
      { timeout: 3000 },
    );
  });

  it('scopes the query to a saved segment via the demoted Segment control, including cohort_id in every posted body', async () => {
    const capturedBodies: InsightsQueryDefinition[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        const body = (await request.json()) as InsightsQueryDefinition;
        capturedBodies.push(body);
        return HttpResponse.json({
          series: [
            { name: 'checkout_completed', breakdown_value: null, data: [{ t: '2026-06-29', value: 5 }] },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    // The segment picker is demoted behind "+ Segment", like Filter and Group by.
    expect(screen.queryByLabelText('Segment')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Segment' }));
    await screen.findByRole('option', { name: 'Recent buyers' });

    // Selecting the segment re-runs both the current-range query and the previous-period KPI
    // comparison — only bodies posted from here on should carry the segment scope.
    capturedBodies.length = 0;
    await userEvent.selectOptions(screen.getByLabelText('Segment'), 'Recent buyers');
    expect(await screen.findByText('≈ 137 users')).toBeInTheDocument();

    await waitFor(() => expect(capturedBodies.length).toBeGreaterThanOrEqual(2));
    for (const body of capturedBodies) {
      expect(body.cohort_id).toBe(TEST_COHORT_ID);
    }
  });

  it('re-runs automatically when a date-range preset is chosen', async () => {
    let capturedBody: InsightsQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        capturedBody = (await request.json()) as InsightsQueryDefinition;
        return HttpResponse.json({
          series: [
            { name: 'checkout_completed', breakdown_value: null, data: [{ t: '2026-06-29', value: 1 }] },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    await userEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }));

    await waitFor(
      () => expect(capturedBody?.date_range).toEqual({ from: defaultDate(7), to: defaultDate(0) }),
      { timeout: 3000 },
    );
  });

  it('switches between line, bar, number, and table views via the chart-type toggle', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    await screen.findByRole('img', { name: 'Insights line chart' }, { timeout: 3000 });
    expect(screen.queryByRole('img', { name: 'Insights bar chart' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Bar' }));
    await screen.findByRole('img', { name: 'Insights bar chart' });
    expect(screen.queryByRole('img', { name: 'Insights line chart' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Number' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'checkout_completed' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('offers the richer chart types (area, stacked, pie) from the chart-type picker', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    // A breakdown yields multiple series, so the composition (pie) view has something to compose.
    await userEvent.click(screen.getByRole('button', { name: 'Group by' }));
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'utm_source');

    await screen.findByRole('img', { name: 'Insights line chart' }, { timeout: 3000 });

    await userEvent.click(screen.getByRole('radio', { name: 'Area' }));
    await screen.findByRole('img', { name: 'Insights area chart' });
    expect(screen.queryByRole('img', { name: 'Insights line chart' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Stacked' }));
    await screen.findByRole('img', { name: 'Insights stacked bar chart' });

    await userEvent.click(screen.getByRole('radio', { name: 'Pie' }));
    await screen.findByRole('img', { name: 'Insights pie chart' });
    // The composition legend carries each series' identity + value, never color alone.
    expect(screen.getByRole('list', { name: 'Composition legend' })).toBeInTheDocument();
  });

  it('shows a KPI summary row with a period-over-period delta and wraps the chart in a titled card', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        const body = (await request.json()) as InsightsQueryDefinition;
        // The previous-period request is the only one whose window ends before the current
        // range's `from` — give it a lower value so the delta is deterministic.
        const isPrevious = body.date_range.to < defaultDate(30);
        return HttpResponse.json({
          series: [
            {
              name: 'checkout_completed',
              breakdown_value: null,
              data: [{ t: body.date_range.from, value: isPrevious ? 50 : 100 }],
            },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForDefaultEvent();

    // The global date-range control seeds the builder and renders in the header.
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await screen.findByRole('img', { name: 'Insights line chart' }, { timeout: 3000 });

    // KPI summary row: current total (100) vs. the previous period (50) → +100%.
    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getByText('+100%')).toBeInTheDocument();

    // The primary chart lives inside a titled ChartCard.
    expect(screen.getByRole('heading', { name: 'Trend' })).toBeInTheDocument();
  });

  it('shows a friendly empty state when the project has no events yet', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/meta/events', () =>
        HttpResponse.json({ events: [] }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    expect(await screen.findByText('No events tracked yet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  describe('shareable analysis URLs (feat-01)', () => {
    it('hydrates the builder from an `s` link and auto-runs the exact encoded query', async () => {
      let capturedBody: InsightsQueryDefinition | undefined;
      server.use(
        http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
          capturedBody = (await request.json()) as InsightsQueryDefinition;
          return HttpResponse.json({
            series: [
              { name: 'signup_completed', breakdown_value: 'ios', data: [{ t: '2026-06-01', value: 3 }] },
            ],
          });
        }),
      );

      const encoded = encodeAnalysisState<InsightsAnalysisState>({
        v: 1,
        events: [{ name: 'signup_completed', aggregation: 'unique_users' }],
        interval: 'week',
        filters: [{ property: 'app_version', op: 'eq', value: 'ios' }],
        breakdownProperty: 'utm_source',
        segmentId: null,
        chartType: 'bar',
        from: '2026-06-01',
        to: '2026-06-15',
      });

      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights?s=${encoded}`);
      await screen.findByRole('heading', { name: 'Insights' });

      // Hydrated builder: the shared event replaces the usual default-selected one.
      expect(await screen.findByLabelText('Measure for signup_completed')).toBeInTheDocument();
      expect(screen.queryByLabelText('Measure for checkout_completed')).toBeNull();

      // Auto-ran with no interaction — the chosen chart type (bar) renders straight away.
      await screen.findByRole('img', { name: 'Insights bar chart' }, { timeout: 3000 });

      await waitFor(() =>
        expect(capturedBody).toEqual({
          events: [{ name: 'signup_completed', aggregation: 'unique_users' }],
          date_range: { from: '2026-06-01', to: '2026-06-15' },
          interval: 'week',
          filters: [{ property: 'app_version', op: 'eq', value: 'ios' }],
          breakdown: { property: 'utm_source' },
        }),
      );
    });

    it('falls back to defaults (no error) for a malformed `s` param', async () => {
      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights?s=not-a-real-encoded-value!!!`);
      await screen.findByRole('heading', { name: 'Insights' });

      // Same default-selection behavior as no param at all — no crash, no visible error.
      expect(await waitForDefaultEvent()).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('writes builder edits back to the `s` search param (debounced, via replace)', async () => {
      signIn();
      const { router } = renderApp(`/projects/${TEST_PROJECT.id}/insights`);
      await screen.findByRole('heading', { name: 'Insights' });
      await waitForDefaultEvent();

      // No `s` param yet — nothing written to the URL until the user actually acts.
      expect(router.state.location.search).not.toHaveProperty('s');

      await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
      await userEvent.click(
        await screen.findByRole('option', { name: 'signup_completed' }),
      );

      await waitFor(
        () => expect((router.state.location.search as { s?: string }).s).toBeTruthy(),
        { timeout: 2000 },
      );

      const pushed = decodeAnalysisState<InsightsAnalysisState>(
        (router.state.location.search as { s?: string }).s,
      );
      expect(pushed?.events).toEqual([
        { name: 'checkout_completed', aggregation: 'total' },
        { name: 'signup_completed', aggregation: 'total' },
      ]);
      expect(pushed?.interval).toBe('day');
    });

    it('copies the current URL to the clipboard and shows a "Link copied" toast', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights`);
      await screen.findByRole('heading', { name: 'Insights' });
      await waitForDefaultEvent();

      await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
      expect(await screen.findByText('Link copied')).toBeInTheDocument();
    });
  });

  describe('Segment Comparison (feat-04)', () => {
    it('selecting a 2nd segment issues one insights request per segment cohort_id and renders both segments in the chart + summary', async () => {
      const capturedBodies: InsightsQueryDefinition[] = [];
      server.use(
        http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
          const body = (await request.json()) as InsightsQueryDefinition;
          capturedBodies.push(body);
          const value = body.cohort_id === TEST_COHORT_ID ? 4 : 10;
          return HttpResponse.json({
            series: [
              { name: 'checkout_completed', breakdown_value: null, data: [{ t: '2026-06-29', value }] },
            ],
          });
        }),
      );

      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights`);
      await screen.findByRole('heading', { name: 'Insights' });
      await waitForDefaultEvent();
      await screen.findByRole('img', { name: 'Insights line chart' }, { timeout: 3000 });

      // Compare is a demoted control, like Filter/Group by/Segment; revealing it starts at just
      // "All users" — still the ordinary single-series view until a 2nd segment joins.
      await userEvent.click(screen.getByRole('button', { name: 'Compare segments' }));
      expect(screen.getByRole('list', { name: 'Segments being compared' })).toBeInTheDocument();
      expect(screen.queryByText('Segment summary')).toBeNull();

      capturedBodies.length = 0;
      await userEvent.click(screen.getByRole('button', { name: 'Add segment to compare' }));
      await userEvent.click(await screen.findByRole('option', { name: 'Recent buyers' }));

      // Compare mode is now on: one query per selected segment, each carrying that segment's
      // cohort_id ("All users" has none), and the single-series auto-run/KPI queries stop firing.
      await waitFor(() => expect(capturedBodies.length).toBe(2));
      expect(new Set(capturedBodies.map((b) => b.cohort_id ?? null))).toEqual(
        new Set([null, TEST_COHORT_ID]),
      );

      await screen.findByRole('heading', { name: 'Segment summary' });
      const tables = screen.getAllByRole('table');
      const [dataTable, summaryTable] = [tables[0]!, tables[tables.length - 1]!];

      // The always-visible data table under the chart doubles as the accessible legend: both
      // segment names are legended, never dropped even though one line might read flat.
      expect(within(dataTable).getByText('All users')).toBeInTheDocument();
      expect(within(dataTable).getByText('Recent buyers')).toBeInTheDocument();

      // Per-segment summary: each segment's total, keyed by name.
      expect(within(summaryTable).getByText('All users')).toBeInTheDocument();
      expect(within(summaryTable).getByText('Recent buyers')).toBeInTheDocument();
      expect(within(summaryTable).getByText('10')).toBeInTheDocument();
      expect(within(summaryTable).getByText('4')).toBeInTheDocument();
    });

    it('stays in normal single-series mode while only "All users" is selected', async () => {
      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights`);
      await screen.findByRole('heading', { name: 'Insights' });
      await waitForDefaultEvent();

      await userEvent.click(screen.getByRole('button', { name: 'Compare segments' }));
      expect(screen.getByText('All users')).toBeInTheDocument();

      // Still just one segment selected — the single-series chart keeps rendering, no compare UI.
      await screen.findByRole('img', { name: 'Insights line chart' }, { timeout: 3000 });
      expect(screen.queryByText('Segment summary')).toBeNull();
      expect(screen.getAllByRole('table')).toHaveLength(1);
    });
  });

  describe('Formula / Ratio Metrics (feat-05)', () => {
    it('enabling Formula mode with two events posts a 2-event query and renders the derived line + KPI', async () => {
      const capturedBodies: InsightsQueryDefinition[] = [];
      server.use(
        http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
          const body = (await request.json()) as InsightsQueryDefinition;
          capturedBodies.push(body);
          return HttpResponse.json({
            series: [
              {
                name: 'checkout_completed',
                breakdown_value: null,
                data: [{ t: '2026-06-29', value: 25 }],
              },
              {
                name: 'product_viewed',
                breakdown_value: null,
                data: [{ t: '2026-06-29', value: 100 }],
              },
            ],
          });
        }),
      );

      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights`);
      await screen.findByRole('heading', { name: 'Insights' });
      await waitForDefaultEvent();

      // Formula is a demoted control, like Filter/Group by/Segment/Compare segments.
      expect(screen.queryByText('Metric A')).toBeNull();

      capturedBodies.length = 0;
      await userEvent.click(screen.getByRole('button', { name: 'Formula' }));

      // Turning it on pre-selects the first two real events as metric A/B (no typing required),
      // which is enough to run a single query carrying exactly those two events.
      expect(await screen.findByLabelText('Metric A')).toBeInTheDocument();
      expect(screen.getByLabelText('Metric B')).toBeInTheDocument();

      await waitFor(() =>
        expect(capturedBodies.some((body) => body.events.length === 2)).toBe(true),
      );
      const formulaBody = capturedBodies.find((body) => body.events.length === 2);
      expect(formulaBody?.events).toEqual([
        { name: 'checkout_completed', aggregation: 'total' },
        { name: 'product_viewed', aggregation: 'total' },
      ]);

      // The single derived line renders instead of the normal multi-series trend...
      await screen.findByRole('img', { name: 'Formula trend chart' });
      expect(screen.queryByRole('img', { name: 'Insights line chart' })).not.toBeInTheDocument();

      // ...alongside a headline KPI for the blended ratio (25 / 100 = 0.25), labelled with the
      // metric names. "0.25" also appears in the always-visible A/B/formula table, and "Formula"
      // also appears in the builder panel + table header, so scope to the KPI hint text (unique)
      // and assert the value within that same card.
      const hint = await screen.findByText('checkout_completed ÷ product_viewed');
      expect(within(hint.parentElement!).getByText('0.25')).toBeInTheDocument();
    });
  });

  describe('Global Filters Bar (feat-02)', () => {
    it('merges an active global filter into the posted query body, and reverts once removed', async () => {
      const capturedBodies: InsightsQueryDefinition[] = [];
      server.use(
        http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
          const body = (await request.json()) as InsightsQueryDefinition;
          capturedBodies.push(body);
          return HttpResponse.json({
            series: [
              { name: 'checkout_completed', breakdown_value: null, data: [{ t: '2026-06-29', value: 5 }] },
            ],
          });
        }),
      );

      signIn();
      renderApp(`/projects/${TEST_PROJECT.id}/insights`);
      await screen.findByRole('heading', { name: 'Insights' });
      await waitForDefaultEvent();
      await waitFor(() => expect(capturedBodies.length).toBeGreaterThan(0));
      expect(capturedBodies.at(-1)?.filters).toEqual([]);

      // The bar starts empty, collapsed to the single subtle add affordance.
      const bar = screen.getByRole('region', { name: 'Global filters' });
      await userEvent.click(
        within(bar).getByRole('button', { name: 'Add a filter to scope the whole workspace' }),
      );

      const popover = await screen.findByRole('dialog', { name: 'Add global filter' });
      // `os` is the first known property, pre-selected as soon as `/meta/properties` resolves.
      await waitFor(() => expect(within(popover).getByLabelText('Filter property')).toHaveValue('os'));
      await userEvent.type(within(popover).getByLabelText('Filter value'), 'ios');
      await userEvent.click(within(popover).getByRole('button', { name: 'Add' }));

      // The chip renders in the bar, and the next posted body carries the merged filter.
      const chip = await within(bar).findByRole('button', { name: 'Remove filter os equals ios' });
      await waitFor(() =>
        expect(capturedBodies.at(-1)?.filters).toEqual([{ property: 'os', op: 'eq', value: 'ios' }]),
      );

      // Removing it reverts every filter-capable query back to no filters.
      capturedBodies.length = 0;
      await userEvent.click(chip);
      expect(within(bar).queryByRole('button', { name: /Remove filter/ })).toBeNull();
      await waitFor(() => expect(capturedBodies.length).toBeGreaterThan(0));
      expect(capturedBodies.at(-1)?.filters).toEqual([]);
    });
  });
});
