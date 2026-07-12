import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type {
  SubscriptionAttributionDriver,
  SubscriptionAttributionScreen,
  SubscriptionRecentEvent,
  SubscriptionTimeToConvertBucket,
  SubscriptionsByProduct,
  SubscriptionsByStore,
} from '../../../lib/api/types';
import { useRcEnabled, useSubscriptionAttribution, useSubscriptionsSummary } from '../../revenuecat/api';
import { colorForIndex } from '../palette';
import { DateRangeControl, useDateRange } from '../date-range';
import { formatCurrency, formatPercent } from '../format';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { BreakdownChart } from './charts/BreakdownChart';
import { ChartCard } from './charts/ChartCard';
import { ComparisonTrend } from './charts/ComparisonTrend';
import { DonutChart } from './charts/DonutChart';
import { KpiTile } from './charts/KpiTile';

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

const DRIVERS_COLUMNS: Array<DataTableColumn<SubscriptionAttributionDriver>> = [
  { key: 'event', header: 'Event', sortable: true },
  { key: 'users', header: 'Users', sortable: true, align: 'right' },
];

const SCREENS_COLUMNS: Array<DataTableColumn<SubscriptionAttributionScreen>> = [
  { key: 'screen_name', header: 'Screen', sortable: true },
  { key: 'users', header: 'Users', sortable: true, align: 'right' },
];

/** Fixed left-to-right order for the time-to-convert buckets — never trust API row order. */
const TIME_TO_CONVERT_BUCKET_ORDER = ['<1d', '1-3d', '3-7d', '7-14d', '14-30d', '30d+'];

function sortTimeToConvertBuckets(
  rows: SubscriptionTimeToConvertBucket[],
): SubscriptionTimeToConvertBucket[] {
  return [...rows].sort(
    (a, b) => TIME_TO_CONVERT_BUCKET_ORDER.indexOf(a.bucket) - TIME_TO_CONVERT_BUCKET_ORDER.indexOf(b.bucket),
  );
}

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
 * The Subscriptions page — RevenueCat-derived subscription metrics (MRR, active/trial counts,
 * churn) for the selected range. Gated on `useRcEnabled`: projects without RevenueCat connected
 * see an upsell empty state instead of the dashboard. Mirrors `RevenuePage`'s composition
 * (`chartState` helper, `PageShell` + `DateRangeControl`, `Reveal` indices).
 */
export function SubscriptionsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/subscriptions' });
  const rcEnabled = useRcEnabled(projectId);
  const { from, to } = useDateRange();
  const { filters: globalFilters } = useGlobalFilters();
  const subscriptions = useSubscriptionsSummary(projectId, from, to, mergeGlobalFilters([], globalFilters));
  const attribution = useSubscriptionAttribution(projectId, from, to);

  if (!rcEnabled) {
    return (
      <PageShell
        projectId={projectId}
        title="Subscriptions"
        description="Subscription analytics powered by RevenueCat."
        breadcrumbs={[{ label: 'Explore' }, { label: 'Subscriptions' }]}
      >
        <EmptyState
          title="Connect RevenueCat"
          description="Connect RevenueCat in project settings to see subscription analytics."
        />
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

  const attributionData = attribution.data;
  const driverRows = attributionData?.drivers ?? [];
  const screenRows = attributionData?.screens ?? [];
  const timeToConvertChartData = sortTimeToConvertBuckets(attributionData?.time_to_convert ?? []).map((row) => ({
    label: row.bucket,
    segments: [{ key: 'users', value: row.users }],
  }));
  const trials = attributionData?.trial_funnel.trials ?? 0;
  const converted = attributionData?.trial_funnel.converted ?? 0;
  const funnelConversionRate = trials > 0 ? converted / trials : 0;
  const attributionState = (isEmpty: boolean) => chartState(attribution.isPending, attribution.isError, isEmpty);

  return (
    <PageShell
      projectId={projectId}
      title="Subscriptions"
      description="MRR, active subscribers, trials, and churn for the selected range."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Subscriptions' }]}
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

      <Reveal index={6}>
        <ChartCard
          title="Conversion drivers"
          description="Events and screens most associated with trial-to-paid conversion."
          state={attributionState(driverRows.length === 0 && screenRows.length === 0)}
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DataTable
              columns={DRIVERS_COLUMNS}
              rows={driverRows}
              caption="Conversion driver events"
              initialSort={{ key: 'users', dir: 'desc' }}
              rowKey={(row) => row.event}
              exportFilename="subscriptions-attribution-drivers"
            />
            <DataTable
              columns={SCREENS_COLUMNS}
              rows={screenRows}
              caption="Conversion driver screens"
              initialSort={{ key: 'users', dir: 'desc' }}
              rowKey={(row) => row.screen_name}
              exportFilename="subscriptions-attribution-screens"
            />
          </div>
        </ChartCard>
      </Reveal>

      <Reveal index={7}>
        <ChartCard
          title="Time to convert"
          description="Elapsed time from trial start to conversion, bucketed."
          state={attributionState(timeToConvertChartData.length === 0)}
        >
          {/* Stacked (single-segment) variant preserves the caller's bucket order — the
              non-stacked BreakdownChart always re-sorts descending by value, which would
              scramble this fixed time-bucket axis. */}
          <BreakdownChart stacked data={timeToConvertChartData} ariaLabel="Trial time-to-convert distribution" />
        </ChartCard>
      </Reveal>

      <Reveal index={8}>
        <ChartCard title="Trial funnel" state={attributionState(trials === 0)}>
          <SectionGrid>
            <KpiTile label="Trials" value={trials} />
            <KpiTile label="Converted" value={converted} />
            <KpiTile label="Conversion rate" value={formatPercent(funnelConversionRate)} />
          </SectionGrid>
        </ChartCard>
      </Reveal>
    </PageShell>
  );
}
