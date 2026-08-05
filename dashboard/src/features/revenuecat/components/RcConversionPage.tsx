import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type {
  SubscriptionAttributionDriver,
  SubscriptionAttributionScreen,
  SubscriptionTimeToConvertBucket,
} from '../../../lib/api/types';
import { useSubscriptionAttribution } from '../api';
import { useProjects } from '../../projects/api';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatPercent } from '../../analytics/format';
import { BreakdownChart } from '../../analytics/components/charts/BreakdownChart';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { KpiTile } from '../../analytics/components/charts/KpiTile';

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

/**
 * MyRevenueCat → Conversion. Correlates RevenueCat subscription events against the SDK's own event
 * stream: which events and screens precede a trial-to-paid conversion, how long it takes, and the
 * trial funnel. Real RevenueCat cannot do this — it has no event stream — which is why this is
 * grouped under "Analyze" rather than mirroring RevenueCat's own IA.
 *
 * Unlike Overview, `useSubscriptionAttribution` ignores global filters, so this page carries no
 * filter-dependent state and owns its own loading/error handling. No connect gate: this renders
 * directly off `mobile_analytics` for every project once `useProjects()` resolves.
 */
export function RcConversionPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/conversion' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const { from, to } = useDateRange();
  const attribution = useSubscriptionAttribution(projectId, from, to);

  // Same discipline as RcOverviewPage/RcSettingsPage: don't render below until `useProjects()`
  // has actually resolved, or a still-loading project briefly flashes an empty shell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Conversion"
        description="What drives trial-to-paid conversion."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Conversion' }]}
      >
        {null}
      </PageShell>
    );
  }

  const data = attribution.data;
  const driverRows = data?.drivers ?? [];
  const screenRows = data?.screens ?? [];
  const timeToConvertChartData = sortTimeToConvertBuckets(data?.time_to_convert ?? []).map((row) => ({
    label: row.bucket,
    segments: [{ key: 'users', value: row.users }],
  }));
  const trials = data?.trial_funnel.trials ?? 0;
  const converted = data?.trial_funnel.converted ?? 0;
  const funnelConversionRate = trials > 0 ? converted / trials : 0;
  const state = (isEmpty: boolean) =>
    attribution.isPending ? 'loading' : attribution.isError ? 'error' : isEmpty ? 'empty' : 'ready';

  return (
    <PageShell
      projectId={projectId}
      title="Conversion"
      description="Events, screens, and elapsed time that precede trial-to-paid conversion."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Conversion' }]}
      dateRangeControl={<DateRangeControl />}
    >
      {/* Page-level loading/error announcement, mirroring RcOverviewPage: `ChartCard`'s own error
          branch has no live region, so without this a failed fetch here was silent to screen
          readers. Split from Overview, these two pages should not disagree on this. */}
      {attribution.isPending && (
        <Reveal index={0}>
          <p role="status">Loading conversion analytics…</p>
        </Reveal>
      )}
      {attribution.isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            Failed to load conversion analytics
          </p>
        </Reveal>
      )}

      {data && (
        <>
          <Reveal index={0}>
            <ChartCard
              title="Conversion drivers"
              description="Events and screens most associated with trial-to-paid conversion."
              state={state(driverRows.length === 0 && screenRows.length === 0)}
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

          <Reveal index={1}>
            <ChartCard
              title="Time to convert"
              description="Elapsed time from trial start to conversion, bucketed."
              state={state(timeToConvertChartData.length === 0)}
            >
              {/* Stacked (single-segment) variant preserves the caller's bucket order — the
                  non-stacked BreakdownChart always re-sorts descending by value, which would
                  scramble this fixed time-bucket axis. */}
              <BreakdownChart
                stacked
                data={timeToConvertChartData}
                ariaLabel="Trial time-to-convert distribution"
              />
            </ChartCard>
          </Reveal>

          <Reveal index={2}>
            <ChartCard title="Trial funnel" state={state(trials === 0)}>
              <SectionGrid>
                <KpiTile label="Trials" value={trials} />
                <KpiTile label="Converted" value={converted} />
                <KpiTile label="Conversion rate" value={formatPercent(funnelConversionRate)} />
              </SectionGrid>
            </ChartCard>
          </Reveal>
        </>
      )}
    </PageShell>
  );
}
