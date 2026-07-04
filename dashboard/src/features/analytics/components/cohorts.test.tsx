import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateCohortRequest } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('CohortsPage', () => {
  it('builds the §16 cohort definition, posts it, and previews the resolved size', async () => {
    let capturedBody: CreateCohortRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/cohorts', async ({ request }) => {
        capturedBody = (await request.json()) as CreateCohortRequest;
        return HttpResponse.json(
          {
            id: 'cohort-new',
            name: capturedBody.name,
            created_by: TEST_USER.id,
            created_at: '2026-07-04T00:00:00.000Z',
            updated_at: '2026-07-04T00:00:00.000Z',
            definition: capturedBody.definition,
          },
          { status: 201 },
        );
      }),
      http.get('/api/v1/projects/:projectId/cohorts/:id/preview', () =>
        HttpResponse.json({ count: 42, sample: ['user-001', 'user-002'] }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });

    await userEvent.type(screen.getByLabelText('Cohort name'), 'Power buyers');
    // The first condition defaults to a behavior condition (gte 1 within 30 days).
    await userEvent.type(screen.getByLabelText('Condition 1 event'), 'checkout_completed');

    await userEvent.click(screen.getByRole('button', { name: 'Save cohort' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'Power buyers',
        definition: {
          match: 'all',
          conditions: [
            {
              type: 'behavior',
              event: 'checkout_completed',
              op: 'gte',
              count: 1,
              within_days: 30,
              filters: [],
            },
          ],
        },
      }),
    );

    // Saving sets the current cohort id, which auto-previews via GET /cohorts/:id/preview.
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText(/user-001/)).toBeInTheDocument();
  });

  it('posts a property + did_not definition when the analyst switches condition types', async () => {
    let capturedBody: CreateCohortRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/cohorts', async ({ request }) => {
        capturedBody = (await request.json()) as CreateCohortRequest;
        return HttpResponse.json(
          {
            id: 'cohort-new',
            name: capturedBody.name,
            created_by: TEST_USER.id,
            created_at: '2026-07-04T00:00:00.000Z',
            updated_at: '2026-07-04T00:00:00.000Z',
            definition: capturedBody.definition,
          },
          { status: 201 },
        );
      }),
      http.get('/api/v1/projects/:projectId/cohorts/:id/preview', () =>
        HttpResponse.json({ count: 5, sample: [] }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });

    await userEvent.type(screen.getByLabelText('Cohort name'), 'Churn risk');

    // Switch condition 1 to a "did not do an event" condition.
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 type'), 'did_not');
    await userEvent.type(screen.getByLabelText('Condition 1 event'), 'app_open');

    await userEvent.click(screen.getByRole('button', { name: 'Save cohort' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'Churn risk',
        definition: {
          match: 'all',
          conditions: [{ type: 'did_not', event: 'app_open', within_days: 7 }],
        },
      }),
    );
  });

  it('lists saved cohorts from GET /cohorts', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });
    expect(await screen.findByText('Recent buyers')).toBeInTheDocument();
  });

  it('shows an empty state when there are no cohorts', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/cohorts', () => HttpResponse.json({ cohorts: [] })),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });
    expect(await screen.findByText('No cohorts yet.')).toBeInTheDocument();
  });
});
