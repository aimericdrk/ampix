import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import { META_PROPERTIES_FIXTURE, TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { InsightsQueryDefinition } from '../../../lib/api/types';
import { openDataTables } from '../../../test/data-tables';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

const PLAN_PROPERTY = META_PROPERTIES_FIXTURE.properties.find((p) => p.name === 'plan')!.name;

/** A breakdown-shaped `plan` response: free=30, pro=50, enterprise=20 (total 100), across 3 buckets. */
function planBreakdownResponse() {
  const buckets = ['2026-06-29', '2026-06-30', '2026-07-01'];
  const perValue = (label: string, values: number[]) => ({
    name: 'checkout_completed',
    breakdown_value: label,
    data: buckets.map((t, i) => ({ t, value: values[i]! })),
  });
  return {
    series: [
      perValue('free', [10, 10, 10]),
      perValue('pro', [15, 15, 20]),
      perValue('enterprise', [5, 5, 10]),
    ],
  };
}

async function selectProperty() {
  await userEvent.click(screen.getByRole('button', { name: 'Property' }));
  await userEvent.click(await screen.findByRole('option', { name: PLAN_PROPERTY }));
}

describe('PropertyExplorerPage', () => {
  it('picking a property posts an insights query with breakdown.property set, and renders the top values, share, trend, and table', async () => {
    let capturedBody: InsightsQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        capturedBody = (await request.json()) as InsightsQueryDefinition;
        return HttpResponse.json(planBreakdownResponse());
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/properties`);
    await screen.findByRole('heading', { name: 'Properties' });
    const main = within(screen.getByRole('main'));

    expect(main.getByText('Choose a property to see its top values.')).toBeInTheDocument();

    await selectProperty();

    // Posts a breakdown query scoped to the (fallback) first event, over the selected property.
    await main.findByText('Distinct values');
    expect(capturedBody?.breakdown).toEqual({ property: PLAN_PROPERTY });
    expect(capturedBody?.events).toEqual([{ name: 'checkout_completed', aggregation: 'total' }]);

    // KPI summary: 3 distinct values, total 100, top value "pro" at 50%.
    expect(main.getByText('3')).toBeInTheDocument();
    // "100" (the grand total) renders both in the KPI tile and the donut's center overlay.
    expect(main.getAllByText('100').length).toBeGreaterThanOrEqual(2);
    expect(main.getByText('50% of total')).toBeInTheDocument();

    // Top-values bars.
    expect(
      await main.findByRole('img', { name: `Top values for ${PLAN_PROPERTY}` }),
    ).toBeInTheDocument();

    // Share donut.
    expect(
      main.getByRole('img', { name: `Share of total for ${PLAN_PROPERTY}` }),
    ).toBeInTheDocument();

    // Trend chart (the top-N breakdown series over time).
    expect(main.getByRole('img', { name: 'Insights line chart' })).toBeInTheDocument();

    // Sortable value table with count + share %, exportable.
    const valuesTable = main.getByRole('table', { name: `Values for ${PLAN_PROPERTY}` });
    expect(within(valuesTable).getByText('30')).toBeInTheDocument();
    expect(within(valuesTable).getByText('20%')).toBeInTheDocument();
  });

  it('shows an empty state when the property has no values in range', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', () =>
        HttpResponse.json({ series: [] }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/properties`);
    await screen.findByRole('heading', { name: 'Properties' });
    const main = within(screen.getByRole('main'));

    await selectProperty();

    expect(
      await main.findByText(`No values for ${PLAN_PROPERTY} in this range.`),
    ).toBeInTheDocument();
    expect(main.queryByText('Distinct values')).not.toBeInTheDocument();
  });

  it('drilling a bar toggles the matching global filter', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', () =>
        HttpResponse.json(planBreakdownResponse()),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/properties`);
    await screen.findByRole('heading', { name: 'Properties' });
    const main = within(screen.getByRole('main'));

    await selectProperty();

    const findBarsTable = async () => {
      const figure = await main.findByRole('img', { name: `Top values for ${PLAN_PROPERTY}` });
      await openDataTables();
      return within(figure.parentElement as HTMLElement).getByRole('table');
    };

    const barsTable = await findBarsTable();
    await userEvent.click(within(barsTable).getByRole('button', { name: 'pro' }));

    // The Global Filter Bar chip is the visible feedback that the drill-down landed.
    expect(
      await main.findByRole('button', { name: `Remove filter ${PLAN_PROPERTY} equals pro` }),
    ).toBeInTheDocument();

    const barsTableSelected = await findBarsTable();
    expect(within(barsTableSelected).getByRole('button', { name: 'pro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
