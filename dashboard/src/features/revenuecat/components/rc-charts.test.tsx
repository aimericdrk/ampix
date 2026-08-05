import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const CHARTS_URL = `/projects/${TEST_PROJECT.id}/rc/charts`;
const base = `/api/v1/projects/:projectId/metrics`;

function problem(status: number) {
  return HttpResponse.json(
    { type: 'about:blank', title: 'Service Unavailable', status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

/** Registers all three metrics endpoints — the page fires all three, and MSW's
 *  onUnhandledRequest:'error' would fail the test if any were missing. */
function metrics(handlers: {
  revenue: () => Response | Promise<Response>;
  mrr: () => Response | Promise<Response>;
  active: () => Response | Promise<Response>;
}) {
  server.use(
    http.get(`${base}/revenue`, handlers.revenue),
    http.get(`${base}/mrr`, handlers.mrr),
    http.get(`${base}/active-subscriptions`, handlers.active),
  );
}

describe('RcChartsPage', () => {
  it('renders the KPI row, three charts, accessible tables, and the approximation footnote from the data', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: () =>
        HttpResponse.json({
          currency: 'USD',
          totalCents: 123400,
          series: [
            { bucket: '2026-07-01', amountCents: 50000 },
            { bucket: '2026-07-02', amountCents: 73400 },
          ],
          byCurrency: [
            { currency: 'USD', totalCents: 123400 },
            { currency: 'EUR', totalCents: 5000 },
          ],
        }),
      mrr: () =>
        HttpResponse.json({
          currency: 'USD',
          mrrCents: 4995,
          series: [{ bucket: '2026-07-01', mrrCents: 4995 }],
          unattributedActiveCount: 2,
          approximate: true,
        }),
      active: () =>
        HttpResponse.json({
          current: 42,
          series: [
            { bucket: '2026-07-01', count: 40 },
            { bucket: '2026-07-02', count: 41 },
          ],
          approximate: true,
        }),
    });
    renderApp(CHARTS_URL);
    const main = within(await screen.findByRole('main'));

    // KPI row
    expect(await main.findByText('Current MRR')).toBeInTheDocument();
    expect(main.getByText('$49.95')).toBeInTheDocument();
    expect(main.getByText('Active subscribers')).toBeInTheDocument();
    expect(main.getByText('42')).toBeInTheDocument(); // active current — unique (series counts are 40/41)
    expect(main.getByText('Revenue in range')).toBeInTheDocument();
    expect(main.getByText('$1,234.00')).toBeInTheDocument();

    // Three charts
    expect(main.getByText('Revenue over time')).toBeInTheDocument();
    expect(main.getByText(/monthly recurring revenue/i)).toBeInTheDocument(); // MRR chart description
    expect(main.getByText('Active subscriptions')).toBeInTheDocument();

    // Accessible per-bucket tables (ComparisonTrend ships them by default)
    expect(main.getAllByText('2026-07-01').length).toBeGreaterThan(0);
    expect(main.getByText('734')).toBeInTheDocument(); // 73400 cents -> $734 in the revenue table

    // Footnote
    expect(main.getByText(/understate past churn/i)).toBeInTheDocument();
    expect(main.getByText(/excluded from MRR/i)).toBeInTheDocument(); // unattributedActiveCount = 2
    expect(main.getByText(/EUR/)).toBeInTheDocument(); // per-currency note
  });

  it('shows a page-level loading status and chart skeletons while the metrics are in flight', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: async () => {
        await delay('infinite');
        return HttpResponse.json({});
      },
      mrr: async () => {
        await delay('infinite');
        return HttpResponse.json({});
      },
      active: async () => {
        await delay('infinite');
        return HttpResponse.json({});
      },
    });
    renderApp(CHARTS_URL);

    expect(await screen.findByText(/loading purchase metrics/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('kpi-tile-skeleton')).toHaveLength(3);
  });

  it('renders zeros (not a crash) when the project has no purchases yet', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: () =>
        HttpResponse.json({ currency: null, totalCents: 0, series: [], byCurrency: [] }),
      mrr: () =>
        HttpResponse.json({
          currency: null,
          mrrCents: 0,
          series: [],
          unattributedActiveCount: 0,
          approximate: true,
        }),
      active: () => HttpResponse.json({ current: 0, series: [], approximate: true }),
    });
    renderApp(CHARTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('Current MRR')).toBeInTheDocument();
    expect(main.getAllByText('$0.00').length).toBeGreaterThan(0); // MRR + revenue-in-range
    // Empty series -> each ChartCard shows its empty slot, not a broken chart.
    expect(main.getAllByText('No data for this range.')).toHaveLength(3);
  });

  it('surfaces a page-level alert and the ChartCard error slot when the purchase service fails', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: () => problem(503),
      mrr: () => problem(503),
      active: () => problem(503),
    });
    renderApp(CHARTS_URL);

    expect(await screen.findByRole('alert')).toHaveTextContent(/purchase service/i);
    // The alert plus the three ChartCard error slots all carry the same message.
    expect(screen.getAllByText(/purchase service/i).length).toBeGreaterThanOrEqual(2);
  });
});
