import { Link, useParams } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageShell } from '../../../components/layout/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { Reveal } from '../../../components/ui/reveal';
import {
  isTileError,
  type AnalysisResult,
  type DashboardSummary,
  type EventSummaryRow,
  type InsightsQueryDefinition,
  type SavedReportSummary,
} from '../../../lib/api/types';
import { useEventSummary } from '../../projects/api';
import {
  useDashboard,
  useDashboardData,
  useDashboards,
  useEngagement,
  useInsightsQuery,
  useReportPreview,
  useReports,
  useSessionsSummary,
} from '../api';
import { detectAnomalies } from '../anomaly';
import { useAnnotations } from '../annotations';
import { DateRangeControl, useDateRange } from '../date-range';
import { FavoriteButton } from '../../favorites/FavoriteButton';
import { useFavorites } from '../../favorites/favorites';
import type { FavItem } from '../../favorites/favorites';
import { useRecents } from '../../favorites/recents';
import { favItemRoute } from '../../favorites/routes';
import {
  breakdownBars,
  installsByCountry,
  pctDelta,
  previousRange,
  seriesTrendRows,
  sumSeries,
  type CountryInstallRow,
} from '../derive';
import { formatDurationMs, formatPercent } from '../format';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { computeHighlights, type HighlightMetricInput } from '../highlights';
import { colorForIndex } from '../palette';
import { AnnotationsManager } from './AnnotationsManager';
import { ChartThumbnail, type ChartThumbnailState } from './ChartThumbnail';
import { HomeHighlights } from './HomeHighlights';
import { analysisResultIsEmpty } from './ReportChart';
import { AnomalyCallout } from './charts/AnomalyCallout';
import { BreakdownChart } from './charts/BreakdownChart';
import { ChartCard } from './charts/ChartCard';
import { ComparisonTrend } from './charts/ComparisonTrend';
import { DonutChart } from './charts/DonutChart';
import { KpiTile } from './charts/KpiTile';
import { WorldChoropleth } from './charts/WorldChoropleth';

/** Sorts engagement-style points (`{ t, ... }`) oldest → newest without mutating the input. */
function sortByT<T extends { t: string }>(points: T[]): T[] {
  return [...points].sort((a, b) => a.t.localeCompare(b.t));
}

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop in one place. */
function chartState(isPending: boolean, isError: boolean, isEmpty: boolean): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading';
  if (isError) return 'error';
  if (isEmpty) return 'empty';
  return 'ready';
}

/**
 * The project overview — the most-seen page, rebuilt as a data-dense pulse on the project: a KPI
 * row (volume, engagement, sessions), an active-users trend against the previous period,
 * composition + breakdown charts, a top-events table, and recent saved work. Everything below the
 * onboarding branch is time-scoped by the global `useDateRange`.
 */
export function HomePage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/home' });
  const { from, to } = useDateRange();
  const prev = previousRange(from, to);
  // Chart Annotations (feat-08): one shared per-project note set, shown on every trend chart.
  const { annotations, add: addAnnotation, remove: removeAnnotation } = useAnnotations(projectId);
  // Global Filters Bar (feat-02): AND-joins onto every insights-based chart below, AND (T2) onto
  // the engagement/sessions-driven KPIs via the metric endpoints' optional `filters` param.
  const { filters: globalFilters, toggleGlobalFilter } = useGlobalFilters();
  const kpiFilters = mergeGlobalFilters([], globalFilters);
  // feat-03 §3.2: the currently-active global filter value (if any) for each drillable breakdown,
  // so the matching bar/table-row can render its selected treatment.
  const activeOsFilter = globalFilters.find((f) => f.property === 'os' && f.op === 'eq')?.value;
  const activeVersionFilter = globalFilters.find(
    (f) => f.property === 'app_version' && f.op === 'eq',
  )?.value;

  const summary = useEventSummary(projectId);
  const totalEvents = summary.data?.total ?? 0;
  const byEvent = summary.data?.by_event ?? [];

  const sessionsCurrent = useSessionsSummary(projectId, from, to, kpiFilters);
  const sessionsPrevious = useSessionsSummary(projectId, prev.from, prev.to, kpiFilters);

  // DAU/WAU/MAU mapping: the endpoint tags `active` points by `metric`, chosen by the requested
  // `interval` (day → dau, week → wau, month → mau) — see `EngagementActivePoint` in types.ts. So
  // each metric needs its own call at the matching interval; a single call can't surface all three.
  const dayEngagement = useEngagement(projectId, from, to, 'day', kpiFilters);
  const dayEngagementPrevious = useEngagement(projectId, prev.from, prev.to, 'day', kpiFilters);
  const weekEngagement = useEngagement(projectId, from, to, 'week', kpiFilters);
  const monthEngagement = useEngagement(projectId, from, to, 'month', kpiFilters);

  // The top (by all-time count) event names drive every range-scoped insights query below — the
  // insights engine has no "all events" wildcard, only named events.
  const eventNames = byEvent.slice(0, 5).map((row) => ({ name: row.event, aggregation: 'total' as const }));
  const hasEventNames = eventNames.length > 0;

  const currentDef: InsightsQueryDefinition = {
    events: eventNames,
    date_range: { from, to },
    interval: 'day',
    filters: mergeGlobalFilters([], globalFilters),
  };
  const previousDef: InsightsQueryDefinition = {
    ...currentDef,
    date_range: { from: prev.from, to: prev.to },
  };
  const osDef: InsightsQueryDefinition = { ...currentDef, breakdown: { property: 'os' } };
  const versionDef: InsightsQueryDefinition = { ...currentDef, breakdown: { property: 'app_version' } };
  const utmDef: InsightsQueryDefinition = { ...currentDef, breakdown: { property: 'utm_source' } };

  // Users by country/OS (feat-18 §3.4): distinct users grouped by their `country`/`os`, over the
  // universal `$app_open` event. We deliberately do NOT use `$first_open`: it fires at SDK init,
  // before app code can call `registerSuperProperties({'country': …})`, so it never carries a
  // country. `$app_open` fires every launch and carries the PERSISTED super property, so this
  // populates from any events sent after the app set its country. `unique_users` counts distinct
  // users per country (a device that opens the app many times counts once).
  const installsBaseDef: InsightsQueryDefinition = {
    events: [{ name: '$app_open', aggregation: 'unique_users' }],
    date_range: { from, to },
    interval: 'day',
    filters: mergeGlobalFilters([], globalFilters),
  };
  const installsCountryDef: InsightsQueryDefinition = {
    ...installsBaseDef,
    breakdown: { property: 'country' },
  };
  const installsOsDef: InsightsQueryDefinition = { ...installsBaseDef, breakdown: { property: 'os' } };

  // The previous-period query re-runs `previousDef`, which is only meaningful once both bounds of
  // the (current) range are non-empty — a cleared custom "From" would otherwise fire a `from=''`
  // request, consistent with how `useEngagement` gates itself.
  const hasRange = from.length > 0 && to.length > 0;
  const totalsCurrent = useInsightsQuery(projectId, currentDef, hasEventNames);
  const totalsPrevious = useInsightsQuery(projectId, previousDef, hasEventNames && hasRange);
  const osInsights = useInsightsQuery(projectId, osDef, hasEventNames);
  const versionInsights = useInsightsQuery(projectId, versionDef, hasEventNames);
  const utmInsights = useInsightsQuery(projectId, utmDef, hasEventNames);
  const installsCountry = useInsightsQuery(projectId, installsCountryDef, hasRange);
  const installsOs = useInsightsQuery(projectId, installsOsDef, hasRange);

  const reports = useReports(projectId);
  const dashboards = useDashboards(projectId);
  // Favorites & Recents (feat-13 §3): a flat list of starred/recently-viewed entities, near the
  // existing recent-work lists.
  const favorites = useFavorites(projectId);
  const recents = useRecents(projectId);

  // --- KPI derivations ---

  const totalEventsCurrent = totalsCurrent.data ? sumSeries(totalsCurrent.data.series) : 0;
  const totalEventsPrevious = totalsPrevious.data ? sumSeries(totalsPrevious.data.series) : 0;
  const totalEventsDelta =
    totalsCurrent.data && totalsPrevious.data
      ? pctDelta(totalEventsCurrent, totalEventsPrevious)
      : undefined;

  const dauActive = sortByT(dayEngagement.data?.active.filter((p) => p.metric === 'dau') ?? []);
  const dauPreviousActive = sortByT(
    dayEngagementPrevious.data?.active.filter((p) => p.metric === 'dau') ?? [],
  );
  const dauLatest = dauActive.at(-1)?.value;
  const dauPreviousLatest = dauPreviousActive.at(-1)?.value;
  const dauDelta =
    dauLatest !== undefined && dauPreviousLatest !== undefined
      ? pctDelta(dauLatest, dauPreviousLatest)
      : undefined;

  const wauActive = sortByT(weekEngagement.data?.active.filter((p) => p.metric === 'wau') ?? []);
  const wauLatest = wauActive.at(-1)?.value;
  const mauActive = sortByT(monthEngagement.data?.active.filter((p) => p.metric === 'mau') ?? []);
  const mauLatest = mauActive.at(-1)?.value;

  const stickinessSeries = sortByT(dayEngagement.data?.stickiness ?? []);
  const stickinessLatest = stickinessSeries.at(-1)?.value;
  const stickinessPreviousLatest = sortByT(dayEngagementPrevious.data?.stickiness ?? []).at(-1)?.value;
  const stickinessDelta =
    stickinessLatest !== undefined && stickinessPreviousLatest !== undefined
      ? pctDelta(stickinessLatest, stickinessPreviousLatest)
      : undefined;

  const sessionsDelta =
    sessionsCurrent.data && sessionsPrevious.data
      ? pctDelta(sessionsCurrent.data.sessions, sessionsPrevious.data.sessions)
      : undefined;
  const avgSessionDelta =
    sessionsCurrent.data && sessionsPrevious.data
      ? pctDelta(sessionsCurrent.data.avg_duration_ms, sessionsPrevious.data.avg_duration_ms)
      : undefined;

  const sessionsSpark = sessionsCurrent.data?.by_day.map((d) => d.sessions);
  const avgSessionSpark = sessionsCurrent.data?.by_day.map((d) => d.avg_duration_ms);

  // --- Highlights: plain-language call-outs, reusing the current/previous pairs derived above.
  // Only a metric whose previous-period value is actually loaded gets a line — no extra queries.
  const highlightMetrics: HighlightMetricInput[] = [];
  if (totalsCurrent.data && totalsPrevious.data) {
    highlightMetrics.push({
      label: 'Top-5 events',
      current: totalEventsCurrent,
      previous: totalEventsPrevious,
      unit: 'count',
    });
  }
  if (dauLatest !== undefined && dauPreviousLatest !== undefined) {
    highlightMetrics.push({ label: 'DAU', current: dauLatest, previous: dauPreviousLatest, unit: 'count' });
  }
  if (stickinessLatest !== undefined && stickinessPreviousLatest !== undefined) {
    highlightMetrics.push({
      label: 'Stickiness',
      current: stickinessLatest,
      previous: stickinessPreviousLatest,
      unit: 'percent',
    });
  }
  if (sessionsCurrent.data && sessionsPrevious.data) {
    highlightMetrics.push({
      label: 'Sessions',
      current: sessionsCurrent.data.sessions,
      previous: sessionsPrevious.data.sessions,
      unit: 'count',
    });
    highlightMetrics.push({
      label: 'Avg. session',
      current: sessionsCurrent.data.avg_duration_ms,
      previous: sessionsPrevious.data.avg_duration_ms,
      unit: 'duration',
    });
  }
  const topEventRow = byEvent[0];
  const highlights = computeHighlights(
    highlightMetrics,
    topEventRow ? { topEvent: { event: topEventRow.event, count: topEventRow.count } } : undefined,
  );

  // --- Chart data ---

  // KPI sparklines (enrichment): every series here is data HomePage already fetched for the
  // headline numbers above — no extra API calls, just reusing the same responses' per-bucket
  // values as a magnitude-over-time backdrop (KpiTile no-ops below 2 points, e.g. a single-bucket
  // MAU window).
  const totalEventsSpark = totalsCurrent.data
    ? seriesTrendRows(totalsCurrent.data.series).map((row) => row.value)
    : undefined;
  const dauSpark = dauActive.map((p) => p.value);
  const wauSpark = wauActive.map((p) => p.value);
  const mauSpark = mauActive.map((p) => p.value);
  const stickinessSpark = stickinessSeries.map((p) => p.value);

  const activeTrendCurrent = dauActive.map((p) => ({ t: p.t, value: p.value }));
  const activeTrendPrevious = dauPreviousActive.map((p) => ({ t: p.t, value: p.value }));
  const activeTrendAnomalies = detectAnomalies(activeTrendCurrent);
  const activeUsersDailyColumns: Array<DataTableColumn<{ t: string; value: number }>> = [
    { key: 't', header: 'Date', sortable: true },
    { key: 'value', header: 'Active users', align: 'right', sortable: true },
  ];

  const eventSlices = byEvent
    .slice(0, 8)
    .map((row) => ({ key: row.event, label: row.event, value: row.count }));
  const sliceColor = new Map(eventSlices.map((s, i) => [s.key, colorForIndex(i)]));

  const topEventsColumns: Array<DataTableColumn<EventSummaryRow>> = [
    { key: 'event', header: 'Event', sortable: true },
    { key: 'count', header: 'Count', sortable: true, align: 'right' },
  ];

  const osBars = osInsights.data ? breakdownBars(osInsights.data) : [];
  const versionBars = versionInsights.data ? breakdownBars(versionInsights.data) : [];
  const utmBars = utmInsights.data ? breakdownBars(utmInsights.data) : [];

  // Installations (feat-18 §3.4): fold the country breakdown through `toIso3` into map/table data;
  // "empty" means no `$first_open` events carried a resolvable country at all (no data, or every
  // value landed in the Unknown bucket) — the by-OS chart still renders independently below.
  const installsData = installsByCountry(installsCountry.data);
  const installsOsBars = installsOs.data ? breakdownBars(installsOs.data) : [];
  const installsCountryEmpty =
    !installsCountry.isPending && !installsCountry.isError && installsData.countryCount === 0;
  const topInstallsCountry = installsData.countryCount > 0 ? installsData.rows[0] : undefined;
  const installsCountryColumns: Array<DataTableColumn<CountryInstallRow>> = [
    { key: 'name', header: 'Country', sortable: true },
    { key: 'count', header: 'Installs', align: 'right', sortable: true },
    {
      key: 'share',
      header: 'Share %',
      align: 'right',
      sortable: true,
      render: (row) => formatPercent(row.share),
    },
  ];

  const reportItems: RecentItem[] = (reports.data?.reports ?? []).slice(0, 5).map((r) => ({
    id: r.id,
    name: r.name,
    to: '/projects/$projectId/reports/$reportId',
    params: { projectId, reportId: r.id },
    thumbnail: <HomeReportThumbnail projectId={projectId} report={r} />,
  }));
  const dashboardItems: RecentItem[] = (dashboards.data?.dashboards ?? []).slice(0, 5).map((d) => ({
    id: d.id,
    name: d.name,
    to: '/projects/$projectId/dashboards/$dashboardId',
    params: { projectId, dashboardId: d.id },
    thumbnail: <HomeDashboardThumbnail projectId={projectId} dashboard={d} />,
  }));

  return (
    <PageShell
      projectId={projectId}
      title="Home"
      description="A data-dense pulse on your project — key numbers, trends, and recent work for the selected range."
      dateRangeControl={<DateRangeControl />}
    >
      {totalEvents === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Inbox}
              title="No events yet"
              description="Send your first events using this project's ingest token, then your metrics will appear here."
              action={
                <Link
                  to="/projects/$projectId"
                  params={{ projectId }}
                  className="text-sm text-accent underline"
                >
                  View ingest token
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Reveal index={0}>
            <HomeHighlights highlights={highlights} />
          </Reveal>

          <Reveal index={1}>
            <SectionGrid>
              <KpiTile
                label="Top-5 events"
                value={totalEventsCurrent}
                hint="Sum of the 5 most-frequent event types, selected range"
                spark={totalEventsSpark}
                delta={totalEventsDelta !== undefined ? { pct: totalEventsDelta } : undefined}
                loading={totalsCurrent.isPending}
              />
              <KpiTile
                label="DAU"
                value={dauLatest ?? 0}
                hint="Daily active users"
                spark={dauSpark}
                delta={dauDelta !== undefined ? { pct: dauDelta } : undefined}
                loading={dayEngagement.isPending}
              />
              <KpiTile
                label="WAU"
                value={wauLatest ?? 0}
                hint="Weekly active users"
                spark={wauSpark}
                loading={weekEngagement.isPending}
              />
              <KpiTile
                label="MAU"
                value={mauLatest ?? 0}
                hint="Monthly active users"
                spark={mauSpark}
                loading={monthEngagement.isPending}
              />
              <KpiTile
                label="Sessions"
                value={sessionsCurrent.data?.sessions ?? 0}
                hint="Selected range"
                spark={sessionsSpark}
                delta={sessionsDelta !== undefined ? { pct: sessionsDelta } : undefined}
                loading={sessionsCurrent.isPending}
              />
              <KpiTile
                label="Avg. session"
                value={formatDurationMs(sessionsCurrent.data?.avg_duration_ms ?? 0)}
                spark={avgSessionSpark}
                delta={avgSessionDelta !== undefined ? { pct: avgSessionDelta } : undefined}
                loading={sessionsCurrent.isPending}
              />
              <KpiTile
                label="Stickiness"
                value={stickinessLatest !== undefined ? formatPercent(stickinessLatest) : '—'}
                hint="DAU ÷ active-range ratio"
                spark={stickinessSpark}
                delta={stickinessDelta !== undefined ? { pct: stickinessDelta } : undefined}
                loading={dayEngagement.isPending}
              />
            </SectionGrid>
          </Reveal>

          {/* Users by country/OS (feat-18): distinct users grouped by their `country`/`os` super
              property, over `$app_open`. A world map + by-country table + by-OS breakdown. */}
          <Reveal index={2}>
            <SectionGrid>
              <KpiTile
                label="Total users"
                value={installsData.total}
                hint="Distinct users (by country), selected range"
                loading={installsCountry.isPending}
              />
              <KpiTile
                label="Countries"
                value={installsData.countryCount}
                hint="Distinct countries with users"
                loading={installsCountry.isPending}
              />
              {topInstallsCountry && (
                <KpiTile
                  label="Top country"
                  value={topInstallsCountry.name}
                  hint={`${formatPercent(topInstallsCountry.share)} of users`}
                  loading={installsCountry.isPending}
                />
              )}
            </SectionGrid>
          </Reveal>

          <Reveal index={3}>
            <ChartCard
              title="Users by country"
              description="Distinct users by resolved country (from the app's `country` super property), selected range."
              state={chartState(installsCountry.isPending, installsCountry.isError, installsCountryEmpty)}
              emptyText="No users with a country yet — set a `country` super property in your app: `MyAmpix.instance.registerSuperProperties({'country': 'US'})`. It attaches to events sent afterward (the map reads `$app_open`)."
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <WorldChoropleth
                  data={installsData.mapData}
                  ariaLabel="Users by country"
                  valueLabel="users"
                />
                <DataTable
                  columns={installsCountryColumns}
                  rows={installsData.rows}
                  caption="Users by country"
                  initialSort={{ key: 'count', dir: 'desc' }}
                  rowKey={(row) => row.iso3 ?? 'unknown'}
                  exportFilename="users-by-country"
                />
              </div>
            </ChartCard>
          </Reveal>

          <Reveal index={4}>
            <ChartCard
              title="Users by OS"
              state={chartState(installsOs.isPending, installsOs.isError, installsOsBars.length === 0)}
            >
              <BreakdownChart data={installsOsBars} ariaLabel="Users by OS" />
            </ChartCard>
          </Reveal>

          <Reveal index={5}>
            <ChartCard
              title="Active users"
              description="Daily active users vs. the previous period."
              state={chartState(dayEngagement.isPending, dayEngagement.isError, activeTrendCurrent.length === 0)}
              exportImageName="active-users-trend"
              action={
                <AnnotationsManager
                  annotations={annotations}
                  onAdd={addAnnotation}
                  onRemove={removeAnnotation}
                />
              }
            >
              <ComparisonTrend
                current={activeTrendCurrent}
                previous={activeTrendPrevious}
                xKey="t"
                valueKey="value"
                label="Active users"
                ariaLabel="Active users trend"
                anomalies={activeTrendAnomalies}
                annotations={annotations}
                // The day-by-day list lives in the collapsible "Daily breakdown" below, so hide
                // this chart's own fixed table to avoid showing it twice.
                showDataTable={false}
              />
              <AnomalyCallout anomalies={activeTrendAnomalies} />
              {/* The graph itself always shows; only this per-day breakdown collapses (closed by
                  default) so the card stays a chart first, table-on-demand second. */}
              <CollapsibleSection
                title="Daily breakdown"
                defaultOpen={false}
                className="mt-4"
              >
                <DataTable
                  columns={activeUsersDailyColumns}
                  rows={activeTrendCurrent}
                  caption="Active users by day"
                  initialSort={{ key: 't', dir: 'desc' }}
                  rowKey={(row) => row.t}
                  exportFilename="active-users-by-day"
                />
              </CollapsibleSection>
            </ChartCard>
          </Reveal>

          <Reveal index={5}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartCard title="Events by type" state={eventSlices.length === 0 ? 'empty' : 'ready'}>
                <DonutChart
                  slices={eventSlices}
                  colorFor={(key) => sliceColor.get(key) ?? 'var(--series-1)'}
                  ariaLabel="Events by type composition"
                  centerLabel="All-time total"
                  centerValue={totalEvents}
                />
              </ChartCard>

              <ChartCard title="Top events">
                <DataTable
                  columns={topEventsColumns}
                  rows={byEvent}
                  caption="Top events by count"
                  initialSort={{ key: 'count', dir: 'desc' }}
                  rowKey={(row) => row.event}
                  exportFilename="top-events"
                />
              </ChartCard>
            </div>
          </Reveal>

          <Reveal index={5}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartCard
                title="By OS"
                state={chartState(osInsights.isPending, osInsights.isError, osBars.length === 0)}
                exportImageName="events-by-os"
              >
                <BreakdownChart
                  data={osBars}
                  ariaLabel="Events by OS"
                  onSelectValue={(value) => toggleGlobalFilter({ property: 'os', op: 'eq', value })}
                  selectedValue={activeOsFilter}
                />
              </ChartCard>
              <ChartCard
                title="By app version"
                state={chartState(
                  versionInsights.isPending,
                  versionInsights.isError,
                  versionBars.length === 0,
                )}
              >
                <BreakdownChart
                  data={versionBars}
                  ariaLabel="Events by app version"
                  onSelectValue={(value) =>
                    toggleGlobalFilter({ property: 'app_version', op: 'eq', value })
                  }
                  selectedValue={activeVersionFilter}
                />
              </ChartCard>
            </div>
          </Reveal>

          {/* Acquisition: skip entirely once loaded with nothing to show, rather than showing an
              empty chart card for a property that may not be tracked at all. */}
          {(utmInsights.isPending || utmBars.length > 0) && (
            <Reveal index={5}>
              <ChartCard
                title="Acquisition · UTM source"
                state={chartState(utmInsights.isPending, utmInsights.isError, utmBars.length === 0)}
              >
                <BreakdownChart data={utmBars} ariaLabel="Acquisition by UTM source" />
              </ChartCard>
            </Reveal>
          )}
        </>
      )}

      {/* Favorites & Recently viewed (feat-13 §3): quick access to starred and last-visited
          entities, ahead of the per-kind recent-work lists below. */}
      <Reveal index={5}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FavItemList
            title="Favorites"
            emptyText="Star a report, dashboard, cohort, or user to pin it here."
            items={favorites.list}
            projectId={projectId}
            onUnstar={(item) => favorites.toggle(item)}
          />
          <FavItemList
            title="Recently viewed"
            emptyText="Reports, dashboards, and user profiles you open will show up here."
            items={recents.list}
            projectId={projectId}
          />
        </div>
      </Reveal>

      {/* Recent work */}
      <Reveal index={5}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RecentList
            title="Recent reports"
            emptyText="No saved reports yet — build one in Insights."
            items={reportItems}
            seeAllTo="/projects/$projectId/reports"
            projectId={projectId}
          />
          <RecentList
            title="Recent dashboards"
            emptyText="No dashboards yet — create one to pin your charts."
            items={dashboardItems}
            seeAllTo="/projects/$projectId/dashboards"
            projectId={projectId}
          />
        </div>
      </Reveal>
    </PageShell>
  );
}

/** A saved report's live decorative preview, mirroring `ReportsPage`'s `ReportCard` thumbnail. */
function HomeReportThumbnail({
  projectId,
  report,
}: {
  projectId: string;
  report: SavedReportSummary;
}) {
  const preview = useReportPreview(projectId, report.id);

  let state: ChartThumbnailState;
  if (preview.isPending) state = 'loading';
  else if (preview.isError || !preview.data) state = 'error';
  else if (analysisResultIsEmpty(report.kind, preview.data)) state = 'empty';
  else state = 'ready';

  return <ChartThumbnail kind={report.kind} result={preview.data} state={state} />;
}

/** A dashboard's live decorative preview (first tile), mirroring `DashboardsPage`'s card thumbnail. */
function HomeDashboardThumbnail({
  projectId,
  dashboard,
}: {
  projectId: string;
  dashboard: DashboardSummary;
}) {
  if (dashboard.tile_count === 0) {
    return <ChartThumbnail kind="insights" state="empty" emptyLabel="Empty board" />;
  }
  return <HomeLoadedDashboardThumbnail projectId={projectId} dashboardId={dashboard.id} />;
}

function HomeLoadedDashboardThumbnail({
  projectId,
  dashboardId,
}: {
  projectId: string;
  dashboardId: string;
}) {
  const dashboard = useDashboard(projectId, dashboardId);
  const data = useDashboardData(projectId, dashboardId);

  const firstTile = [...(dashboard.data?.tiles ?? [])].sort((a, b) => a.position - b.position)[0];
  const tileResult = data.data?.tiles.find((t) => t.id === firstTile?.id)?.result;

  let state: ChartThumbnailState;
  let result: AnalysisResult | undefined;
  if (dashboard.isPending || data.isPending) {
    state = 'loading';
  } else if (dashboard.isError || data.isError || !firstTile || !tileResult) {
    state = 'error';
  } else if (isTileError(tileResult)) {
    state = 'error';
  } else if (analysisResultIsEmpty(firstTile.kind, tileResult)) {
    state = 'empty';
  } else {
    state = 'ready';
    result = tileResult;
  }

  return <ChartThumbnail kind={firstTile?.kind ?? 'insights'} result={result} state={state} />;
}

/**
 * The Favorites / Recently-viewed section (feat-13 §5): a flat list of `FavItem` links, each
 * routed via the shared `favItemRoute` map. When `onUnstar` is given (Favorites), each row also
 * gets a `FavoriteButton` so it can be unstarred right from Home without visiting the entity.
 */
function FavItemList({
  title,
  emptyText,
  items,
  projectId,
  onUnstar,
}: {
  title: string;
  emptyText: string;
  items: FavItem[];
  projectId: string;
  onUnstar?: (item: FavItem) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{emptyText}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => {
              const route = favItemRoute(item, projectId);
              return (
                <li
                  key={`${item.type}-${item.id}`}
                  className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <Link
                    to={route.to}
                    params={route.params}
                    className="flex-1 truncate text-sm text-text hover:text-accent hover:underline"
                  >
                    {item.name}
                  </Link>
                  {onUnstar && (
                    <FavoriteButton name={item.name} isFavorite onToggle={() => onUnstar(item)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface RecentItem {
  id: string;
  name: string;
  to: string;
  params: Record<string, string>;
  thumbnail?: ReactNode;
}

function RecentList({
  title,
  emptyText,
  items,
  seeAllTo,
  projectId,
}: {
  title: string;
  emptyText: string;
  items: RecentItem[];
  seeAllTo: string;
  projectId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link to={seeAllTo} params={{ projectId }} className="text-xs text-accent underline">
          See all
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{emptyText}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
                {item.thumbnail}
                <Link
                  to={item.to}
                  params={item.params}
                  className="text-sm text-text hover:text-accent hover:underline"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
