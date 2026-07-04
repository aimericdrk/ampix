import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { InsightsQueryDefinition } from '../../../lib/api/types';
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
  const breakdownSelect = screen.getByLabelText('Breakdown (optional)');
  await within(breakdownSelect).findByRole('option', { name: firstProperty.name });
  return breakdownSelect;
}

describe('InsightsPage', () => {
  it('builds the §14 query definition from the builder state and renders the series in the chart and table', async () => {
    let capturedBody: InsightsQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
        capturedBody = (await request.json()) as InsightsQueryDefinition;
        return HttpResponse.json({
          series: [
            {
              name: 'checkout_completed',
              breakdown_value: 'tiktok',
              data: [
                { t: '2026-06-29', value: 5 },
                { t: '2026-06-30', value: 7 },
              ],
            },
            {
              name: 'checkout_completed',
              breakdown_value: 'facebook',
              data: [
                { t: '2026-06-29', value: 2 },
                { t: '2026-06-30', value: 9 },
              ],
            },
          ],
        });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForMetaLoaded();

    // Add one event, then switch its aggregation to unique_users.
    await userEvent.type(screen.getByLabelText('Add an event'), 'checkout_completed');
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.getByText('checkout_completed')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText('Aggregation for checkout_completed'),
      'unique_users',
    );

    // Date range + interval.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-29' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-30' } });
    await userEvent.selectOptions(screen.getByLabelText('Interval'), 'week');

    // One filter.
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    await userEvent.selectOptions(screen.getByLabelText('Filter property'), 'app_version');
    await userEvent.selectOptions(screen.getByLabelText('Filter operator'), 'eq');
    await userEvent.type(screen.getByLabelText('Filter value'), 'ios');

    // Breakdown.
    await userEvent.selectOptions(screen.getByLabelText('Breakdown (optional)'), 'utm_source');

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByRole('img', { name: 'Insights line chart' });

    expect(capturedBody).toEqual({
      events: [{ name: 'checkout_completed', aggregation: 'unique_users' }],
      date_range: { from: '2026-06-29', to: '2026-06-30' },
      interval: 'week',
      filters: [{ property: 'app_version', op: 'eq', value: 'ios' }],
      breakdown: { property: 'utm_source' },
    });

    // The table view is always present, regardless of the chart-type toggle — one row per
    // (event × breakdown value × date) bucket, so scope each assertion to its own row.
    const table = screen.getByRole('table', { name: 'Insights data table' });
    const dataRows = within(table).getAllByRole('row').slice(1);
    const tiktokJune30 = dataRows.find(
      (row) => within(row).queryByText('tiktok') && within(row).queryByText('2026-06-30'),
    );
    const facebookJune30 = dataRows.find(
      (row) => within(row).queryByText('facebook') && within(row).queryByText('2026-06-30'),
    );
    expect(tiktokJune30).toBeDefined();
    expect(facebookJune30).toBeDefined();
    expect(within(tiktokJune30 as HTMLElement).getByText('7')).toBeInTheDocument();
    expect(within(facebookJune30 as HTMLElement).getByText('9')).toBeInTheDocument();
  });

  it('switches between line, bar, number, and table views via the chart-type toggle', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });
    await waitForMetaLoaded();

    await userEvent.type(screen.getByLabelText('Add an event'), 'product_viewed');
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByRole('img', { name: 'Insights line chart' });
    expect(screen.queryByRole('img', { name: 'Insights bar chart' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Bar' }));
    await screen.findByRole('img', { name: 'Insights bar chart' });
    expect(screen.queryByRole('img', { name: 'Insights line chart' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Number' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'product_viewed' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });
});
