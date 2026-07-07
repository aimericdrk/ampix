import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  REVENUE_SUMMARY_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('RevenuePage', () => {
  it('shows revenue KPIs, a revenue trend, and a by-product breakdown', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/revenue`);

    await screen.findByRole('heading', { name: 'Revenue' });
    // Scope label lookups to the page content — the sidebar nav also renders a "Revenue" link.
    const main = within(screen.getByRole('main'));

    for (const label of ['Total revenue', 'Paying users', 'ARPPU', 'Avg purchase value']) {
      expect(await main.findByText(label)).toBeInTheDocument();
    }
    // "Purchases" also labels the by-product table's sortable column header, so assert at least
    // one match (the KPI tile) rather than a single unique node.
    expect((await main.findAllByText('Purchases')).length).toBeGreaterThan(0);

    // Currency-formatted KPI values.
    expect(main.getByText('$480.00')).toBeInTheDocument(); // total_revenue
    expect(main.getByText('$16.00')).toBeInTheDocument(); // arppu
    expect(main.getByText('$12.00')).toBeInTheDocument(); // avg_purchase_value
    expect(main.getByText(String(REVENUE_SUMMARY_FIXTURE.purchases))).toBeInTheDocument();
    expect(main.getByText(String(REVENUE_SUMMARY_FIXTURE.paying_users))).toBeInTheDocument();

    // Revenue-by-day trend.
    expect(await main.findByRole('img', { name: 'Revenue trend' })).toBeInTheDocument();

    // By-product breakdown chart + table, each product represented.
    expect(main.getByRole('img', { name: 'Revenue by product' })).toBeInTheDocument();
    for (const product of REVENUE_SUMMARY_FIXTURE.by_product) {
      expect(main.getAllByText(product.product_id).length).toBeGreaterThan(0);
    }
  });

  it('shows an empty state when there are no purchases in range', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/revenue', () =>
        HttpResponse.json({
          total_revenue: 0,
          purchases: 0,
          paying_users: 0,
          arppu: 0,
          avg_purchase_value: 0,
          by_day: [],
          by_product: [],
        }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/revenue`);

    await screen.findByRole('heading', { name: 'Revenue' });
    const main = within(screen.getByRole('main'));
    expect(await main.findByText('No revenue yet')).toBeInTheDocument();
    expect(main.queryByText('Total revenue')).not.toBeInTheDocument();
  });
});
