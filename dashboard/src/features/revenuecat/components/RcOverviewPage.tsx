import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type {
  SubscriptionRecentEvent,
  SubscriptionsByProduct,
  SubscriptionsByStore,
} from '../../../lib/api/types';
import { useRcSummary } from '../purchase-metrics-api';
import { useProjects } from '../../projects/api';
import { colorForIndex } from '../../analytics/palette';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatCurrency, formatPercent } from '../../analytics/format';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { ComparisonTrend } from '../../analytics/components/charts/ComparisonTrend';
import { DonutChart } from '../../analytics/components/charts/DonutChart';
import { KpiTile } from '../../analytics/components/charts/KpiTile';

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop in one place (mirrors Revenue/Home). */
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

const BY_PRODUCT_COLUMNS: Array<DataTableColumn<SubscriptionsByProduct>> = [
  { key: 'product_id', header: 'Product', sortable: true },
  { key: 'active', header: 'Active', sortable: true, align: 'right' },
  {
    key: 'mrr',
    header: 'Monthly revenue',
    sortable: true,
    align: 'right',
    render: (row) => formatCurrency(row.mrr_cents / 100),
    sortValue: (row) => row.mrr_cents,
  },
];

const BY_STORE_COLUMNS: Array<DataTableColumn<SubscriptionsByStore>> = [
  { key: 'store', header: 'Store', sortable: true },
  { key: 'active', header: 'Active', sortable: true, align: 'right' },
];

const RECENT_EVENTS_COLUMNS: Array<DataTableColumn<SubscriptionRecentEvent>> = [
  {
    key: 'timestamp',
    header: 'Time',
    sortable: true,
    render: (row) => new Date(row.timestamp).toLocaleString(),
  },
  { key: 'event', header: 'Event', sortable: true },
  { key: 'distinct_id', header: 'User', sortable: true },
  { key: 'product_id', header: 'Product', sortable: true },
  {
    key: 'price',
    header: 'Price',
    sortable: true,
    align: 'right',
    render: (row) => formatCurrency(row.price),
  },
];

/**
 * MyRevenueCat → Overview. The `mobile_purchase` billing-authority summary (MRR, active/trial
 * counts, churn) for the selected range, from `useRcSummary`. Attribution lives on the separate
 * Conversion page — the two are split along the query boundary, so neither straddles a data
 * source. No connect gate: MyRevenueCat is the self-hosted clone, so this renders directly off
 * `mobile_purchase` for every project once `useProjects()` resolves.
 */
export function RcOverviewPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/overview' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const { from, to } = useDateRange();
  const subscriptions = useRcSummary(projectId, from, to);

  // Mirrors RcSettingsPage/RcChartsPage: nothing renders until `useProjects()` has actually
  // resolved, so a still-loading project briefly flashes an empty shell instead of stale content.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Overview"
        description="Subscription analytics powered by RevenueCat."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Overview' }]}
      >
        {null}
      </PageShell>
    );
  }

  const data = subscriptions.data;

  const trend = data?.by_day.map((day) => ({ t: day.t, new_subscriptions: day.new_subscriptions })) ?? [];
  const churnSlices =
    data?.churn_reasons.map((reason) => ({ key: reason.reason, label: reason.reason, value: reason.count })) ?? [];
  const churnColor = new Map(churnSlices.map((slice, index) => [slice.key, colorForIndex(index)]));

  const trialsConverted = data?.trials_converted ?? 0;
  const trialsStarted = data?.trials_started ?? 0;
  const trialConversionRate = trialsStarted > 0 ? trialsConverted / trialsStarted : 0;

  return (
    <PageShell
      projectId={projectId}
      title="Overview"
      description="MRR, active subscribers, trials, and churn for the selected range."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Overview' }]}
      dateRangeControl={<DateRangeControl />}
    >
      {subscriptions.isPending && (
        <Reveal index={0}>
          <p role="status">Loading subscriptions summary…</p>
        </Reveal>
      )}
      {subscriptions.isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            Failed to load subscriptions summary
          </p>
        </Reveal>
      )}

      {data && (
        <>
          <Reveal index={0}>
            <SectionGrid>
              <KpiTile label="MRR" value={formatCurrency(data.mrr_cents / 100)} unfiltered />
              <KpiTile label="Active subscribers" value={data.active} unfiltered />
              <KpiTile label="In trial" value={data.in_trial} unfiltered />
              <KpiTile label="New subscriptions" value={data.new_subscriptions} />
              <KpiTile label="Churned" value={data.churned} />
              <KpiTile label="Trial→paid" value={formatPercent(trialConversionRate)} />
            </SectionGrid>
          </Reveal>

          <Reveal index={1}>
            <ChartCard
              title="New subscriptions"
              description="Daily new subscriptions for the selected range."
              state={chartState(subscriptions.isPending, subscriptions.isError, trend.length === 0)}
              exportImageName="subscriptions-new-trend"
            >
              <ComparisonTrend
                current={trend}
                xKey="t"
                valueKey="new_subscriptions"
                label="New subscriptions"
                ariaLabel="New subscriptions trend"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={2}>
            <ChartCard
              title="Churn reasons"
              state={chartState(subscriptions.isPending, subscriptions.isError, churnSlices.length === 0)}
            >
              <DonutChart
                slices={churnSlices}
                colorFor={(key) => churnColor.get(key) ?? 'var(--series-1)'}
                ariaLabel="Churn reasons composition"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={3}>
            <ChartCard title="By product">
              <DataTable
                columns={BY_PRODUCT_COLUMNS}
                rows={data.by_product}
                caption="Per-product subscription breakdown"
                initialSort={{ key: 'mrr', dir: 'desc' }}
                rowKey={(row) => row.product_id}
                exportFilename="subscriptions-by-product"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={4}>
            <ChartCard title="By store">
              <DataTable
                columns={BY_STORE_COLUMNS}
                rows={data.by_store}
                caption="Subscriptions by store"
                initialSort={{ key: 'active', dir: 'desc' }}
                rowKey={(row) => row.store}
                exportFilename="subscriptions-by-store"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={5}>
            <ChartCard title="Recent events">
              <DataTable
                columns={RECENT_EVENTS_COLUMNS}
                rows={data.recent_events}
                caption="Recent subscription events"
                initialSort={{ key: 'timestamp', dir: 'desc' }}
                rowKey={(row) => row.insert_id}
                exportFilename="subscriptions-recent-events"
              />
            </ChartCard>
          </Reveal>
        </>
      )}
    </PageShell>
  );
}
