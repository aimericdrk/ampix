import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type { RevenueByProduct } from '../../../lib/api/types';
import { useRevenue } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { formatCurrency } from '../format';
import { BreakdownChart, type BreakdownDatum } from './charts/BreakdownChart';
import { ChartCard } from './charts/ChartCard';
import { ComparisonTrend } from './charts/ComparisonTrend';
import { KpiTile } from './charts/KpiTile';

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop in one place (mirrors Home). */
function chartState(
  isPending: boolean,
  isError: boolean,
  isEmpty: boolean,
): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading';
  if (isError) return 'error';
  if (isEmpty) return 'empty';
  return 'ready';
}

const BY_PRODUCT_COLUMNS: Array<DataTableColumn<RevenueByProduct>> = [
  { key: 'product_id', header: 'Product', sortable: true },
  {
    key: 'revenue',
    header: 'Revenue',
    sortable: true,
    align: 'right',
    render: (row) => formatCurrency(row.revenue),
  },
  { key: 'purchases', header: 'Purchases', sortable: true, align: 'right' },
];

/**
 * The Revenue page — in-app purchase revenue (`$in_app_purchase`'s `$price`) over the selected
 * range: a KPI row (total revenue, purchases, paying users, ARPPU, avg purchase value), a daily
 * revenue trend, and a by-product breakdown (chart + table). Time-scoped by the global
 * `useDateRange`, mirroring `HomePage`'s composition of the same v4 primitives.
 */
export function RevenuePage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/revenue' });
  const { from, to } = useDateRange();
  const revenue = useRevenue(projectId, from, to);

  const data = revenue.data;
  const hasPurchases = (data?.purchases ?? 0) > 0;

  const trend = data?.by_day.map((day) => ({ t: day.t, value: day.revenue })) ?? [];
  const byProductBars: BreakdownDatum[] =
    data?.by_product.map((p) => ({ label: p.product_id, value: p.revenue })) ?? [];

  return (
    <PageShell
      projectId={projectId}
      title="Revenue"
      description="In-app purchase revenue, ARPPU, and top products for the selected range."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Revenue' }]}
      dateRangeControl={<DateRangeControl />}
    >
      {revenue.isPending && <p role="status">Loading revenue summary…</p>}
      {revenue.isError && (
        <p role="alert" className="text-danger">
          Failed to load revenue summary
        </p>
      )}

      {data && !hasPurchases && (
        <Card>
          <CardHeader>
            <CardTitle>No revenue yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            No in-app purchases (<code>$in_app_purchase</code>) recorded in the selected range.
          </CardContent>
        </Card>
      )}

      {data && hasPurchases && (
        <>
          <SectionGrid>
            <KpiTile label="Total revenue" value={formatCurrency(data.total_revenue)} />
            <KpiTile label="Purchases" value={data.purchases} />
            <KpiTile label="Paying users" value={data.paying_users} />
            <KpiTile
              label="ARPPU"
              value={formatCurrency(data.arppu)}
              hint="Average revenue per paying user"
            />
            <KpiTile label="Avg purchase value" value={formatCurrency(data.avg_purchase_value)} />
          </SectionGrid>

          <ChartCard
            title="Revenue"
            description="Daily revenue for the selected range."
            state={chartState(revenue.isPending, revenue.isError, trend.length === 0)}
            exportImageName="revenue-trend"
          >
            <ComparisonTrend
              current={trend}
              xKey="t"
              valueKey="value"
              label="Revenue"
              ariaLabel="Revenue trend"
            />
          </ChartCard>

          <ChartCard
            title="Revenue by product"
            state={chartState(revenue.isPending, revenue.isError, byProductBars.length === 0)}
          >
            <BreakdownChart data={byProductBars} ariaLabel="Revenue by product" />
          </ChartCard>

          <ChartCard title="By product">
            <DataTable
              columns={BY_PRODUCT_COLUMNS}
              rows={data.by_product}
              caption="Revenue by product"
              initialSort={{ key: 'revenue', dir: 'desc' }}
              rowKey={(row) => row.product_id}
              exportFilename="revenue-by-product"
            />
          </ChartCard>
        </>
      )}
    </PageShell>
  );
}
