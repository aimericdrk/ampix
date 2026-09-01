import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  EXPERIMENT_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { ExperimentQueryDefinition, ExperimentResponse } from '../../../lib/api/types';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

async function renderExperiments() {
  signIn();
  renderApp(`/projects/${TEST_PROJECT.id}/experiments`);
  await screen.findByRole('heading', { name: 'Experiments' });
  return within(screen.getByRole('main'));
}

/** Picks a value out of one of the page's searchable comboboxes, addressed by its field label. */
async function pick(main: ReturnType<typeof within>, field: string, option: string) {
  await userEvent.click(main.getByRole('button', { name: field }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** Fills in the three fields the query needs and presses Run. */
async function runDefaultExperiment(main: ReturnType<typeof within>) {
  await pick(main, 'Variant property', 'plan');
  await pick(main, 'Exposure event', 'product_viewed');
  await pick(main, 'Goal event', 'checkout_completed');
  await userEvent.click(main.getByRole('button', { name: 'Run experiment' }));
}

describe('ExperimentsPage', () => {
  it('asks for the test setup before running anything', async () => {
    const main = await renderExperiments();
    expect(main.getByText('Describe your test')).toBeInTheDocument();
    // Nothing is guessed: without all three the run is unavailable.
    expect(main.getByRole('button', { name: 'Run experiment' })).toBeDisabled();
  });

  it('sends the picked variant property, exposure event, goal event and window', async () => {
    let body: ExperimentQueryDefinition | null = null;
    server.use(
      http.post('/api/v1/projects/:projectId/query/experiment', async ({ request }) => {
        body = (await request.json()) as ExperimentQueryDefinition;
        return HttpResponse.json(EXPERIMENT_FIXTURE);
      }),
    );

    const main = await renderExperiments();
    await runDefaultExperiment(main);

    await main.findByText('Participants');
    expect(body).toMatchObject({
      variant_property: 'plan',
      variant_target: 'event',
      exposure_event: 'product_viewed',
      goal_event: 'checkout_completed',
      conversion_window_days: 7,
    });
    // The conversion window has to be a real date range, not an open-ended scan.
    expect(body!.date_range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports each arm’s rate, the uplift, and the significance verdict', async () => {
    const main = await renderExperiments();
    await runDefaultExperiment(main);

    const table = within(
      await main.findByRole('table', {
        name: /Per-variant conversion, uplift against the control, and statistical significance/i,
      }),
    );
    expect(table.getByText('control')).toBeInTheDocument();
    expect(table.getByText('treatment')).toBeInTheDocument();
    expect(table.getByText('10.0%')).toBeInTheDocument();
    expect(table.getByText('15.0%')).toBeInTheDocument();
    expect(table.getByText('+50.0%')).toBeInTheDocument();
    expect(table.getByText('+5.0 pts')).toBeInTheDocument();
    // A p-value that small is reported as a bound — printing 0.000 would read as certainty.
    expect(table.getByText('< 0.001')).toBeInTheDocument();
    expect(table.getByText('Significantly better')).toBeInTheDocument();
    // The control is the baseline, not a result compared against itself.
    expect(table.getByText('Baseline')).toBeInTheDocument();
  });

  it('calls a significantly WORSE variant worse, not a win', async () => {
    const worse: ExperimentResponse = {
      ...EXPERIMENT_FIXTURE,
      variants: [
        EXPERIMENT_FIXTURE.variants[0]!,
        {
          ...EXPERIMENT_FIXTURE.variants[1]!,
          converted: 100,
          conversion_rate: 0.05,
          comparison: {
            relative_uplift: -0.5,
            absolute_uplift: -0.05,
            p_value: 0.0000012,
            z_score: -4.79,
            confidence_interval: { low: -0.0705, high: -0.0295 },
            significant: true,
          },
        },
      ],
    };
    server.use(
      http.post('/api/v1/projects/:projectId/query/experiment', () => HttpResponse.json(worse)),
    );

    const main = await renderExperiments();
    await runDefaultExperiment(main);

    expect(await main.findByText('Significantly worse')).toBeInTheDocument();
    expect(main.getByText('−50.0%')).toBeInTheDocument();
  });

  it('warns rather than declaring a winner when an arm is underpowered', async () => {
    const thin: ExperimentResponse = {
      ...EXPERIMENT_FIXTURE,
      has_enough_data: false,
      variants: [
        EXPERIMENT_FIXTURE.variants[0]!,
        {
          ...EXPERIMENT_FIXTURE.variants[1]!,
          exposed: 12,
          converted: 4,
          conversion_rate: 4 / 12,
          underpowered: true,
        },
      ],
    };
    server.use(
      http.post('/api/v1/projects/:projectId/query/experiment', () => HttpResponse.json(thin)),
    );

    const main = await renderExperiments();
    await runDefaultExperiment(main);

    expect(await main.findByText('Not enough data')).toBeInTheDocument();
    expect(main.getByText(/before calling a winner/i)).toBeInTheDocument();
    // The numbers are still shown — flagged, not withheld.
    expect(main.getByText('33.3%')).toBeInTheDocument();
  });

  it('says "No clear difference" when the test is not significant', async () => {
    const flat: ExperimentResponse = {
      ...EXPERIMENT_FIXTURE,
      variants: [
        EXPERIMENT_FIXTURE.variants[0]!,
        {
          ...EXPERIMENT_FIXTURE.variants[1]!,
          converted: 210,
          conversion_rate: 0.105,
          comparison: {
            relative_uplift: 0.05,
            absolute_uplift: 0.005,
            p_value: 0.58,
            z_score: 0.55,
            confidence_interval: { low: -0.013, high: 0.023 },
            significant: false,
          },
        },
      ],
    };
    server.use(
      http.post('/api/v1/projects/:projectId/query/experiment', () => HttpResponse.json(flat)),
    );

    const main = await renderExperiments();
    await runDefaultExperiment(main);

    expect(await main.findByText('No clear difference')).toBeInTheDocument();
    expect(main.getByText('0.580')).toBeInTheDocument();
  });

  it('explains an empty result instead of showing an all-zero table', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/experiment', () =>
        HttpResponse.json({
          control_variant: null,
          total_exposed: 0,
          total_converted: 0,
          variants: [],
          has_enough_data: false,
        }),
      ),
    );

    const main = await renderExperiments();
    await runDefaultExperiment(main);

    expect(await main.findByText('No participants in this range')).toBeInTheDocument();
  });

  it('surfaces the server’s validation detail on a bad query', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/experiment', () =>
        HttpResponse.json(
          { title: 'Bad Request', detail: 'exposure_event: Required', status: 400 },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const main = await renderExperiments();
    await runDefaultExperiment(main);

    expect(await main.findByRole('alert')).toHaveTextContent('exposure_event: Required');
  });

  it('offers "Save as report" only once there is a result to save', async () => {
    const main = await renderExperiments();
    expect(screen.queryByRole('button', { name: 'Save as report' })).not.toBeInTheDocument();

    await runDefaultExperiment(main);
    await main.findByText('Participants');
    expect(await screen.findByRole('button', { name: 'Save as report' })).toBeInTheDocument();
  });
});
