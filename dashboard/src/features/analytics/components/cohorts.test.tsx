import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CohortDefinition, CreateCohortRequest } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Picks a real event through the predefined combobox picker (no raw typing). */
async function pickEvent(triggerName: string, query: string, optionName: string) {
  await userEvent.click(screen.getByRole('button', { name: triggerName }));
  await userEvent.type(await screen.findByRole('combobox', { name: 'Search events' }), query);
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('CohortsPage', () => {
  it('shows a LIVE preview from the quick builder before any save, then saves the cohort', async () => {
    let previewCalls = 0;
    let lastPreviewedEvent = '';
    let capturedBody: CreateCohortRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/cohorts/preview', async ({ request }) => {
        previewCalls += 1;
        const def = (await request.json()) as CohortDefinition;
        const first = def.conditions[0];
        lastPreviewedEvent = first && 'event' in first ? first.event : '';
        // Count reacts to the chosen event, so the assertion proves the preview is live.
        return HttpResponse.json({ count: lastPreviewedEvent ? 128 : 0, sample: ['user-001'] });
      }),
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
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });

    await userEvent.type(screen.getByLabelText('Cohort name'), 'Power buyers');

    // Choose the event from the predefined picker — the quick builder default is "did event in 30 days".
    await pickEvent('Event', 'checkout', 'checkout_completed');

    // The live preview POSTs the in-progress definition and renders the size WITHOUT saving.
    expect(await screen.findByText('128')).toBeInTheDocument();
    expect(previewCalls).toBeGreaterThan(0);
    expect(lastPreviewedEvent).toBe('checkout_completed');
    expect(capturedBody).toBeUndefined();

    // Saving still creates the cohort from that same definition.
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
  });

  it('composes did_not + property conditions through the advanced pickers', async () => {
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
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });

    await userEvent.type(screen.getByLabelText('Cohort name'), 'Churn risk');

    // Reveal the advanced multi-condition builder.
    await userEvent.click(screen.getByRole('button', { name: /add conditions & filters/i }));

    // Condition 1 → "did not do an event", event chosen via the predefined picker.
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 type'), 'did_not');
    await pickEvent('Condition 1 event', 'app', 'app_opened');

    // Condition 2 → a property match (property/op are predefined selects; value is free text).
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Condition 2 type'), 'property');
    await userEvent.type(screen.getByLabelText('Condition 2 value'), 'Android');

    await userEvent.click(screen.getByRole('button', { name: 'Save cohort' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'Churn risk',
        definition: {
          match: 'all',
          conditions: [
            { type: 'did_not', event: 'app_opened', within_days: 7 },
            { type: 'property', property: 'os', op: 'eq', value: 'Android' },
          ],
        },
      }),
    );
  });

  it('loads an existing cohort definition into the builder when Edit is clicked', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/cohorts`);
    await screen.findByRole('heading', { name: 'Cohorts' });

    // The seed cohort "Recent buyers" is a behavior on checkout_completed within 30 days.
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Recent buyers' }));

    expect(await screen.findByText('Edit cohort')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Recent buyers')).toBeInTheDocument();
    // The primary event picker shows the loaded event (not an empty placeholder).
    expect(screen.getByRole('button', { name: 'Event' })).toHaveTextContent('checkout_completed');
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
