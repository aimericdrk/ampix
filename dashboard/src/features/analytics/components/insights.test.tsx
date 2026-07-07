import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { InsightsQueryDefinition } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import { defaultDate } from './builder-controls';

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
});
