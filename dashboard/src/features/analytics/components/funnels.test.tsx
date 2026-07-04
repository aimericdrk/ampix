import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { FunnelQueryDefinition, FunnelResponse } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import {
  META_PROPERTIES_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

async function waitForMetaLoaded() {
  const firstProperty = META_PROPERTIES_FIXTURE.properties[0];
  if (!firstProperty) throw new Error('META_PROPERTIES_FIXTURE must not be empty');
  const breakdown = screen.getByLabelText('Breakdown (optional)');
  await within(breakdown).findByRole('option', { name: firstProperty.name });
}

async function addStep(name: string) {
  await userEvent.type(screen.getByLabelText('Add a step event'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
}

const THREE_STEP_RESPONSE: FunnelResponse = {
  steps: [
    { event: 'app_open', count: 1000, conversion_from_prev: 1, conversion_from_top: 1 },
    { event: 'signup_started', count: 620, conversion_from_prev: 0.62, conversion_from_top: 0.62 },
    {
      event: 'checkout_completed',
      count: 145,
      conversion_from_prev: 0.234,
      conversion_from_top: 0.145,
    },
  ],
  overall_conversion: 0.145,
};

describe('FunnelsPage', () => {
  it('posts the §15 funnel body from the builder and renders the exact step counts + conversions', async () => {
    let capturedBody: FunnelQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/funnels', async ({ request }) => {
        capturedBody = (await request.json()) as FunnelQueryDefinition;
        return HttpResponse.json(THREE_STEP_RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/funnels`);
    await screen.findByRole('heading', { name: 'Funnels' });
    await waitForMetaLoaded();

    await addStep('app_open');
    await addStep('signup_started');
    await addStep('checkout_completed');

    // A per-step filter on step 1 (os = android) — the first "Add filter" belongs to step 1.
    await userEvent.click(screen.getAllByRole('button', { name: 'Add filter' })[0]!);
    await userEvent.type(screen.getByLabelText('Step 1 filter value 1'), 'android');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Conversion window (days)'), { target: { value: '14' } });
    await userEvent.selectOptions(screen.getByLabelText('Step order'), 'strict_order');

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByRole('img', { name: 'Funnel chart' });

    expect(capturedBody).toEqual({
      steps: [
        { event: 'app_open', filters: [{ property: 'os', op: 'eq', value: 'android' }] },
        { event: 'signup_started', filters: [] },
        { event: 'checkout_completed', filters: [] },
      ],
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      window_days: 14,
      order: 'strict_order',
    });

    // Overall conversion headline.
    expect(screen.getByText('Overall conversion:').textContent).toContain('14.5%');

    // The always-present data table: one row per step, scoped so the two conversion columns don't
    // clash.
    const table = screen.getByRole('table', { name: 'Funnel data table' });
    const rows = within(table).getAllByRole('row').slice(1);
    const appRow = rows.find((r) => within(r).queryByText('app_open'));
    const signupRow = rows.find((r) => within(r).queryByText('signup_started'));
    const checkoutRow = rows.find((r) => within(r).queryByText('checkout_completed'));

    expect(within(appRow as HTMLElement).getByText('1,000')).toBeInTheDocument();
    expect(within(signupRow as HTMLElement).getByText('620')).toBeInTheDocument();
    const checkout = within(checkoutRow as HTMLElement);
    expect(checkout.getByText('145')).toBeInTheDocument();
    expect(checkout.getByText('23.4%')).toBeInTheDocument(); // from previous
    expect(checkout.getByText('14.5%')).toBeInTheDocument(); // from top
  });

  it('draws one funnel per breakdown value with a legend when a breakdown is set', async () => {
    const breakdownResponse: FunnelResponse = {
      steps: THREE_STEP_RESPONSE.steps,
      overall_conversion: 0.145,
      breakdowns: [
        {
          value: 'tiktok',
          overall_conversion: 0.21,
          steps: [
            { event: 'app_open', count: 500, conversion_from_prev: 1, conversion_from_top: 1 },
            {
              event: 'signup_started',
              count: 300,
              conversion_from_prev: 0.6,
              conversion_from_top: 0.6,
            },
            {
              event: 'checkout_completed',
              count: 105,
              conversion_from_prev: 0.35,
              conversion_from_top: 0.21,
            },
          ],
        },
        {
          value: 'facebook',
          overall_conversion: 0.1,
          steps: [
            { event: 'app_open', count: 500, conversion_from_prev: 1, conversion_from_top: 1 },
            {
              event: 'signup_started',
              count: 320,
              conversion_from_prev: 0.64,
              conversion_from_top: 0.64,
            },
            {
              event: 'checkout_completed',
              count: 50,
              conversion_from_prev: 0.156,
              conversion_from_top: 0.1,
            },
          ],
        },
      ],
    };
    server.use(
      http.post('/api/v1/projects/:projectId/query/funnels', () =>
        HttpResponse.json(breakdownResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/funnels`);
    await screen.findByRole('heading', { name: 'Funnels' });
    await waitForMetaLoaded();

    await addStep('app_open');
    await addStep('checkout_completed');
    await userEvent.selectOptions(screen.getByLabelText('Breakdown (optional)'), 'utm_source');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    // Two funnels, each with its own accessible image + a legend naming both values.
    await screen.findByRole('img', { name: 'Funnel for tiktok' });
    expect(screen.getByRole('img', { name: 'Funnel for facebook' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Funnel breakdown legend' });
    expect(within(legend).getByText('tiktok')).toBeInTheDocument();
    expect(within(legend).getByText('facebook')).toBeInTheDocument();
  });

  it('shows the running state while the funnel query is in flight', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/funnels', async () => {
        await delay('infinite');
        return HttpResponse.json(THREE_STEP_RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/funnels`);
    await screen.findByRole('heading', { name: 'Funnels' });
    await waitForMetaLoaded();

    await addStep('app_open');
    await addStep('checkout_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  it('renders an empty state when the funnel has no data', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/funnels', () =>
        HttpResponse.json({ steps: [], overall_conversion: 0 } satisfies FunnelResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/funnels`);
    await screen.findByRole('heading', { name: 'Funnels' });
    await waitForMetaLoaded();

    await addStep('app_open');
    await addStep('checkout_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('No data for this funnel yet.')).toBeInTheDocument();
  });
});
