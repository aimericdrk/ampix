import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateReportRequest } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import {
  META_PROPERTIES_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { TEST_REPORT_INSIGHTS_ID } from '../../../test/msw/phase5-handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

async function waitForInsightsMeta() {
  const firstProperty = META_PROPERTIES_FIXTURE.properties[0];
  if (!firstProperty) throw new Error('META_PROPERTIES_FIXTURE must not be empty');
  const breakdown = screen.getByLabelText('Breakdown (optional)');
  await within(breakdown).findByRole('option', { name: firstProperty.name });
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
    await waitForInsightsMeta();

    await userEvent.type(screen.getByLabelText('Add an event'), 'checkout_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
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

  it('lists saved reports grouped by kind', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/reports`);
    await screen.findByRole('heading', { name: 'Reports' });

    expect(await screen.findByText('Weekly checkouts')).toBeInTheDocument();
    expect(screen.getByText('Signup funnel')).toBeInTheDocument();
    // Group headers, one per non-empty kind.
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Funnels' })).toBeInTheDocument();
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
