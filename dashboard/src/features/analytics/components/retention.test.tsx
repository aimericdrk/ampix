import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { RetentionQueryDefinition, RetentionResponse } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

// Period-1 average is size-weighted: (320*0.65 + 180*0.50) / (320 + 180) = 298 / 500 = 0.596.
const RESPONSE: RetentionResponse = {
  cohorts: [
    {
      cohort: '2026-06-01',
      size: 320,
      periods: [
        { period: 0, count: 320, rate: 1 },
        { period: 1, count: 208, rate: 0.65 },
        { period: 2, count: 112, rate: 0.35 },
      ],
    },
    {
      cohort: '2026-06-02',
      size: 180,
      periods: [
        { period: 0, count: 180, rate: 1 },
        { period: 1, count: 90, rate: 0.5 },
      ],
    },
  ],
  averages: [
    { period: 0, rate: 1 },
    { period: 1, rate: 0.596 },
    { period: 2, rate: 0.35 },
  ],
};

function rowByHeader(header: string): HTMLElement {
  const table = screen.getByRole('table', { name: 'Retention cohort heatmap' });
  const row = within(table)
    .getAllByRole('row')
    .find((r) => within(r).queryByText(header));
  if (!row) throw new Error(`No row for ${header}`);
  return row;
}

describe('RetentionPage', () => {
  it('posts the §15 retention body and renders the cohort grid cells + size-weighted averages', async () => {
    let capturedBody: RetentionQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/retention', async ({ request }) => {
        capturedBody = (await request.json()) as RetentionQueryDefinition;
        return HttpResponse.json(RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/retention`);
    await screen.findByRole('heading', { name: 'Retention' });

    await userEvent.type(screen.getByLabelText('Born event'), 'signup_completed');
    await userEvent.type(
      screen.getByLabelText('Return event (optional — defaults to born event)'),
      'app_open',
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-01' } });
    await userEvent.selectOptions(screen.getByLabelText('Interval'), 'week');
    fireEvent.change(screen.getByLabelText('Periods'), { target: { value: '2' } });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByRole('table', { name: 'Retention cohort heatmap' });

    expect(capturedBody).toEqual({
      born_event: { name: 'signup_completed', filters: [] },
      return_event: { name: 'app_open', filters: [] },
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      interval: 'week',
      periods: 2,
    });

    // Cohort rows: size + per-period rate cells (scoped per row so identical percents don't clash).
    const cohort1 = within(rowByHeader('2026-06-01'));
    expect(cohort1.getByText('320')).toBeInTheDocument();
    expect(cohort1.getByText('65%')).toBeInTheDocument();
    expect(cohort1.getByText('35%')).toBeInTheDocument();

    const cohort2 = within(rowByHeader('2026-06-02'));
    expect(cohort2.getByText('180')).toBeInTheDocument();
    expect(cohort2.getByText('50%')).toBeInTheDocument();
    // Period 2 has not fully elapsed for this cohort — omitted, rendered as a muted dash, not 0.
    expect(cohort2.getByText('—')).toBeInTheDocument();

    // The size-weighted averages footer row.
    const averages = within(rowByHeader('Average'));
    expect(averages.getByText('59.6%')).toBeInTheDocument();
    expect(averages.getByText('500')).toBeInTheDocument(); // total cohort size
  });

  it('omits return_event from the body when it is left blank (defaults to born event server-side)', async () => {
    let capturedBody: RetentionQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/retention', async ({ request }) => {
        capturedBody = (await request.json()) as RetentionQueryDefinition;
        return HttpResponse.json(RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/retention`);
    await screen.findByRole('heading', { name: 'Retention' });

    await userEvent.type(screen.getByLabelText('Born event'), 'signup_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByRole('table', { name: 'Retention cohort heatmap' });
    expect(capturedBody).not.toHaveProperty('return_event');
    expect(capturedBody?.born_event).toEqual({ name: 'signup_completed', filters: [] });
  });

  it('shows the running state while the retention query is in flight', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/retention', async () => {
        await delay('infinite');
        return HttpResponse.json(RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/retention`);
    await screen.findByRole('heading', { name: 'Retention' });

    await userEvent.type(screen.getByLabelText('Born event'), 'signup_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  it('renders an empty state when there are no cohorts', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/retention', () =>
        HttpResponse.json({ cohorts: [], averages: [] } satisfies RetentionResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/retention`);
    await screen.findByRole('heading', { name: 'Retention' });

    await userEvent.type(screen.getByLabelText('Born event'), 'signup_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('No cohorts for this query yet.')).toBeInTheDocument();
  });
});
