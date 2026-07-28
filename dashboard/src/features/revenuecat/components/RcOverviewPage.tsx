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
import { useRcMrrMovement, useRcSummary, type RcGranularity } from '../purchase-metrics-api';
import { useProjects } from '../../projects/api';
import { colorForIndex } from '../../analytics/palette';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatCurrency, formatPercent } from '../../analytics/format';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { ComparisonTrend } from '../../analytics/components/charts/ComparisonTrend';
import { DonutChart } from '../../analytics/components/charts/DonutChart';
import { KpiTile } from '../../analytics/components/charts/KpiTile';
import { MrrMovementChart } from './MrrMovementChart';

/** Pick a bucket granularity from the window span so MRR-movement bars stay readable: daily up to
 *  ~6 weeks, weekly up to ~5 months, monthly beyond. */
function granularityForRange(from: string, to: string): RcGranularity {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (days <= 45) return 'day';
  if (days <= 150) return 'week';
  return 'month';
}

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
  const movementGranularity = granularityForRange(from, to);
  const movement = useRcMrrMovement(projectId, from, to, movementGranularity);

  // Mirrors RcSettingsPage/RcChartsPage: nothing renders until `useProjects()` has actually
  // resolved, so a still-loading project briefly flashes an empty shell instead of stale content.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Overview"
        description="Subscription analytics for your apps."
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

  // KPI context: the MRR tile's delta + sparkline come from the movement endpoint (net change over
  // the window), reconstructing the MRR trajectory from a start-of-window baseline. New/Churned
  // sparklines come straight from the summary's daily series.
  const netCents = movement.data?.totals.net_cents ?? 0;
  const startMrrCents = (data?.mrr_cents ?? 0) - netCents;
  const mrrSpark: number[] = [];
  if (movement.data && movement.data.buckets.length > 0) {
    let running = startMrrCents;
    mrrSpark.push(running / 100);
    for (const bucket of movement.data.buckets) {
      running += bucket.net_cents;
      mrrSpark.push(running / 100);
    }
  }
  const mrrDelta = movement.data && startMrrCents > 0 ? { pct: (netCents / startMrrCents) * 100 } : undefined;
  const newSpark = data?.by_day.map((day) => day.new_subscriptions) ?? [];
  const churnSpark = data?.by_day.map((day) => day.churned) ?? [];

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
              <KpiTile
                label="MRR"
                value={formatCurrency(data.mrr_cents / 100)}
                spark={mrrSpark}
                delta={mrrDelta}
                unfiltered
              />
              <KpiTile label="Active subscribers" value={data.active} unfiltered />
              <KpiTile label="In trial" value={data.in_trial} unfiltered />
              <KpiTile label="New subscriptions" value={data.new_subscriptions} spark={newSpark} />
              <KpiTile label="Churned" value={data.churned} spark={churnSpark} />
              <KpiTile label="Trial→paid" value={formatPercent(trialConversionRate)} />
            </SectionGrid>
          </Reveal>

          <Reveal index={1}>
            <ChartCard
              title="MRR Movement"
              description="How MRR changed each period — new, reactivation and expansion add; contraction and churn subtract."
              state={chartState(
                movement.isPending,
                movement.isError,
                !movement.data || movement.data.buckets.length === 0,
              )}
            >
              {movement.data && (
                <MrrMovementChart
                  buckets={movement.data.buckets}
                  totals={movement.data.totals}
                  currency={movement.data.currency}
                  granularity={movementGranularity}
                  persistKey={`myampix:mrr-movement:${projectId}`}
                />
              )}
            </ChartCard>
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
