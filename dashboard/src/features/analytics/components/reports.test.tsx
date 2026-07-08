import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateReportRequest, CreateTileRequest } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import {
  TEST_DASHBOARD_ID,
  TEST_REPORT_FUNNEL_ID,
  TEST_REPORT_INSIGHTS_ID,
} from '../../../test/msw/phase5-handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('Saved reports', () => {
  it('saves the current Insights view as a report, posting the §16 create body', async () => {
    let capturedBody: CreateReportRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/reports', async ({ request }) => {
        capturedBody = (await request.json()) as CreateReportRequest;
        return HttpResponse.json(
          {
            id: 'report-new',
            name: capturedBody.name,
            kind: capturedBody.kind,
            created_by: TEST_USER.id,
            created_at: '2026-07-04T00:00:00.000Z',
            updated_at: '2026-07-04T00:00:00.000Z',
            definition: capturedBody.definition,
          },
          { status: 201 },
        );
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    // The builder pre-selects the first event (checkout_completed) — wait for its row.
    await screen.findByLabelText('Measure for checkout_completed');

    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-01' } });

    await userEvent.click(screen.getByRole('button', { name: 'Save as report' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Report name'), 'Weekly checkouts');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save report' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'Weekly checkouts',
        kind: 'insights',
        definition: {
          events: [{ name: 'checkout_completed', aggregation: 'total' }],
          date_range: { from: '2026-06-01', to: '2026-07-01' },
          interval: 'day',
          filters: [],
        },
      }),
    );
  });

  it('lists saved reports grouped by kind, each with a live preview thumbnail', async () => {
    // Spy on the per-card preview runs while still serving each report's kind-correct result.
    const runCalls = new Set<string>();
    server.use(
      http.post('/api/v1/projects/:projectId/reports/:id/run', ({ params }) => {
        const id = params.id as string;
        runCalls.add(id);
        const result =
          id === TEST_REPORT_INSIGHTS_ID
            ? {
                series: [
                  {
                    name: 'checkout_completed',
                    breakdown_value: null,
                    data: [{ t: '2026-07-01', value: 17 }],
                  },
                ],
              }
            : {
                steps: [
                  { event: 'app_open', count: 900, conversion_from_prev: 1, conversion_from_top: 1 },
                  { event: 'checkout', count: 270, conversion_from_prev: 0.3, conversion_from_top: 0.3 },
                ],
                overall_conversion: 0.3,
              };
        return HttpResponse.json(result);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/reports`);
    await screen.findByRole('heading', { name: 'Reports' });

    expect(await screen.findByText('Weekly checkouts')).toBeInTheDocument();
    expect(screen.getByText('Signup funnel')).toBeInTheDocument();
    // Group headers, one per non-empty kind.
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Funnels' })).toBeInTheDocument();

    // One decorative thumbnail per report card, each fed by its own auto-run preview.
    expect(screen.getAllByTestId('chart-thumbnail')).toHaveLength(2);
    await waitFor(() =>
      expect(runCalls).toEqual(new Set([TEST_REPORT_INSIGHTS_ID, TEST_REPORT_FUNNEL_ID])),
    );
  });

  it('runs a report and renders its chart via /reports/:id/run', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/reports/${TEST_REPORT_INSIGHTS_ID}`);
    await screen.findByRole('heading', { name: 'Weekly checkouts' });

    // The stored insights definition auto-runs on load and renders the shared Insights chart.
    await screen.findByRole('img', { name: 'Insights line chart' });
    const table = screen.getByRole('table', { name: 'Insights data table' });
    expect(within(table).getByText('17')).toBeInTheDocument();
  });

  it('adds a saved report to a dashboard from its detail page (feat-14, savedReportId variant)', async () => {
    let capturedBody: CreateTileRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/dashboards/:id/tiles', async ({ request, params }) => {
        capturedBody = (await request.json()) as CreateTileRequest;
        expect(params.id).toBe(TEST_DASHBOARD_ID);
        return HttpResponse.json(
          {
            id: 'tile-new',
            title: capturedBody.title,
            kind: capturedBody.kind,
            saved_report_id: capturedBody.saved_report_id ?? null,
            inline_definition: null,
            x: capturedBody.x,
            y: capturedBody.y,
            w: capturedBody.w,
            h: capturedBody.h,
            position: 2,
          },
          { status: 201 },
        );
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/reports/${TEST_REPORT_INSIGHTS_ID}`);
    await screen.findByRole('heading', { name: 'Weekly checkouts' });

    await userEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Growth overview' });
    expect(within(dialog).getByLabelText('Tile title')).toHaveValue('Weekly checkouts');
    await userEvent.selectOptions(within(dialog).getByLabelText('Dashboard'), 'Growth overview');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        title: 'Weekly checkouts',
        kind: 'insights',
        saved_report_id: TEST_REPORT_INSIGHTS_ID,
        x: 0,
        y: 2,
        w: 6,
        h: 4,
      }),
    );
  });

  it('shows an empty state when there are no reports', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/reports', () => HttpResponse.json({ reports: [] })),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/reports`);
    await screen.findByRole('heading', { name: 'Reports' });
    expect(await screen.findByText(/No saved reports yet/)).toBeInTheDocument();
  });
});
