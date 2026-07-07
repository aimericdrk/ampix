import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { ApiError } from '../../../lib/api/problem';
import {
  INSIGHTS_FILTER_OPS,
  INSIGHTS_INTERVALS,
  type InsightsAggregation,
  type InsightsEventQuery,
  type InsightsFilter,
  type InsightsInterval,
  type InsightsQueryDefinition,
  type InsightsResponse,
} from '../../../lib/api/types';
import { useInsightsQuery, useMetaEvents, useMetaProperties, useRunInsights } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { pctDelta, previousRange, sumSeries } from '../derive';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { colorForIndex } from '../palette';
import type { AnalysisStateEnvelope } from '../share-state';
import { useUrlAnalysisState } from '../share-state';
import { ChartCard } from './charts/ChartCard';
import { CopyLinkButton } from './CopyLinkButton';
import { KpiTile } from './charts/KpiTile';
import { INSIGHTS_CHART_TYPES, InsightsChart, type InsightsChartType } from './InsightsChart';
import { PageShell } from '../../../components/layout/PageShell';
import { SaveAsReportButton } from './report-actions';
import { SegmentPicker } from './SegmentPicker';
import { cleanFilters, FilterRows } from './builder-controls';
import { EventPicker, presetIdForRange, useAutoRun } from './explore-controls';

const MAX_EVENTS = 5;

const VALID_CHART_TYPES = new Set<InsightsChartType>(INSIGHTS_CHART_TYPES.map((c) => c.value));

/**
 * Insights' own shareable-URL shape (feat-01 §3.1) — every field mirrors a piece of the builder
 * state above, plus the `from`/`to` range seed. Optional throughout: a link may carry any subset
 * (or, if malformed, none of it) and {@link sanitizeUrlState} fills in sane defaults per field.
 */
export interface InsightsAnalysisState extends AnalysisStateEnvelope {
  from?: string;
  to?: string;
  segmentId?: string | null;
  events?: InsightsEventQuery[];
  interval?: InsightsInterval;
  filters?: InsightsFilter[];
  breakdownProperty?: string;
  chartType?: InsightsChartType;
}

const DEFAULT_URL_STATE: InsightsAnalysisState = { v: 1 };

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface SanitizedInsightsState {
  events: InsightsEventQuery[];
  interval: InsightsInterval;
  filters: InsightsFilter[];
  breakdownProperty: string;
  segmentId: string | null;
  chartType: InsightsChartType;
  from?: string;
  to?: string;
}

/**
 * Validates a decoded `s` param field-by-field, dropping anything that doesn't correspond to a
 * real event/property, isn't a recognized enum value, or isn't the right JS type — a bad/stale
 * link never throws, it just silently loses the offending piece. Returns `null` when there isn't
 * even one usable event, since a query needs at least one to mean anything (the caller then falls
 * back to the normal "pick the first event" default).
 */
function sanitizeUrlState(
  urlState: InsightsAnalysisState,
  { eventOptions, propertyNames }: { eventOptions: string[]; propertyNames: string[] },
): SanitizedInsightsState | null {
  const raw = urlState as unknown as Record<string, unknown>;

  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const seenNames = new Set<string>();
  const events: InsightsEventQuery[] = [];
  for (const candidate of rawEvents) {
    if (events.length >= MAX_EVENTS) break;
    if (!candidate || typeof candidate !== 'object') continue;
    const { name, aggregation } = candidate as Record<string, unknown>;
    if (typeof name !== 'string' || !eventOptions.includes(name) || seenNames.has(name)) continue;
    if (aggregation !== 'total' && aggregation !== 'unique_users') continue;
    seenNames.add(name);
    events.push({ name, aggregation });
  }
  if (events.length === 0) return null;

  const interval =
    typeof raw.interval === 'string' && INSIGHTS_INTERVALS.includes(raw.interval as InsightsInterval)
      ? (raw.interval as InsightsInterval)
      : 'day';

  const rawFilters = Array.isArray(raw.filters) ? raw.filters : [];
  const filters: InsightsFilter[] = [];
  for (const candidate of rawFilters) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { property, op, value } = candidate as Record<string, unknown>;
    if (typeof property !== 'string' || !propertyNames.includes(property)) continue;
    if (typeof op !== 'string' || !INSIGHTS_FILTER_OPS.includes(op as InsightsFilter['op'])) continue;
    if (value !== undefined && typeof value !== 'string') continue;
    filters.push({ property, op: op as InsightsFilter['op'], value: value as string | undefined });
  }

  const breakdownProperty =
    typeof raw.breakdownProperty === 'string' && propertyNames.includes(raw.breakdownProperty)
      ? raw.breakdownProperty
      : '';

  // A stale/deleted segment id can't be told apart from "not loaded yet" here (SegmentPicker owns
  // the live cohort list) — only the shape is validated; an unknown id simply shows unselected.
  const segmentId = typeof raw.segmentId === 'string' ? raw.segmentId : null;

  const chartType =
    typeof raw.chartType === 'string' && VALID_CHART_TYPES.has(raw.chartType as InsightsChartType)
      ? (raw.chartType as InsightsChartType)
      : 'line';

  const from = isDateString(raw.from) ? raw.from : undefined;
  const to = isDateString(raw.to) ? raw.to : undefined;

  return { events, interval, filters, breakdownProperty, segmentId, chartType, from, to };
}

/** Plain-language measure labels — never "aggregation" (contracts §14 values are unchanged). */
const MEASURE_LABELS: Record<InsightsAggregation, string> = {
  total: 'Count',
  unique_users: 'Unique users',
};

/** Granularity in reading order, with friendly "Show by" labels over the §14 interval keywords. */
const INTERVAL_OPTIONS: { value: InsightsInterval; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'hour', label: 'Hourly' },
];

/** A quiet, dashed "+ Label" affordance that reveals a demoted control on demand. */
function AddControlButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="border border-dashed border-border font-normal text-text-muted hover:text-text"
    >
      <span aria-hidden="true">+</span> {label}
    </Button>
  );
}

export function InsightsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/insights' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runInsights = useRunInsights(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Insights shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo, setRange } = useDateRange();
  // Global Filters Bar (feat-02): AND-joins onto this page's own filters right before sending —
  // never mutates the local filter rows, so the builder UI still reflects only what the user set.
  const { filters: globalFilters } = useGlobalFilters();

  // Shareable Analysis URLs (feat-01): the `?s=` param is this page's serialized builder state.
  // `urlState` only changes identity when the param itself changes (mount, or back/forward).
  const { urlState, pushState } = useUrlAnalysisState<InsightsAnalysisState>(DEFAULT_URL_STATE);

  const [events, setEvents] = useState<InsightsEventQuery[]>([]);
  const [interval, setInterval] = useState<InsightsInterval>('day');
  const [filters, setFilters] = useState<InsightsFilter[]>([]);
  const [breakdownProperty, setBreakdownProperty] = useState('');
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [result, setResult] = useState<InsightsResponse | null>(null);
  // The selected visualization is part of the builder state, so it persists across re-runs.
  const [chartType, setChartType] = useState<InsightsChartType>('line');

  // Advanced options stay tucked away until asked for (progressive disclosure).
  const [showFilters, setShowFilters] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showSegment, setShowSegment] = useState(false);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];
  const selectedNames = events.map((e) => e.name);
  const projectHasNoEvents = metaEvents.isSuccess && eventOptions.length === 0;

  // Flips true the moment the builder reflects something worth sharing — either a real user edit,
  // or the state we just hydrated from a link — so `pushState` only ever fires once there's a
  // meaningful view to write back (never on the bare "no param yet" initial render, per §4).
  const userInteractedRef = useRef(false);

  // On first load: hydrate from a shared `s` link (validating field-by-field, dropping anything
  // that doesn't correspond to a real event/property — see `sanitizeUrlState`) once both metadata
  // queries are in, so event/property names can actually be checked. Falls back to pre-selecting
  // the project's first event (previous behavior) when there's no usable `s` state. Only ever runs
  // once, so clearing the builder afterwards stays cleared.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !metaEvents.isSuccess || !metaProperties.isSuccess) return;
    didInit.current = true;

    const hydrated = sanitizeUrlState(urlState, { eventOptions, propertyNames });
    if (hydrated) {
      setEvents(hydrated.events);
      setInterval(hydrated.interval);
      setFilters(hydrated.filters);
      if (hydrated.filters.length > 0) setShowFilters(true);
      if (hydrated.breakdownProperty) {
        setBreakdownProperty(hydrated.breakdownProperty);
        setShowBreakdown(true);
      }
      if (hydrated.segmentId) {
        setSegmentId(hydrated.segmentId);
        setShowSegment(true);
      }
      setChartType(hydrated.chartType);
      if (hydrated.from && hydrated.to) {
        setRange(hydrated.from, hydrated.to, presetIdForRange(hydrated.from, hydrated.to));
      }
      // Self-healing (§4): immediately rewrite a clean `s` reflecting the sanitized state, so a
      // partially-malformed link's dropped fields don't linger in the address bar forever.
      userInteractedRef.current = true;
      return;
    }

    const first = metaEvents.data.events[0];
    if (first && events.length === 0) {
      setEvents([{ name: first, aggregation: 'total' }]);
    }
  }, [
    metaEvents.isSuccess,
    metaEvents.data,
    metaProperties.isSuccess,
    events.length,
    urlState,
    eventOptions,
    propertyNames,
    setRange,
  ]);

  const addEvent = (name: string) => {
    if (events.length >= MAX_EVENTS || events.some((e) => e.name === name)) return;
    userInteractedRef.current = true;
    setEvents((current) => [...current, { name, aggregation: 'total' }]);
  };

  const updateMeasure = (name: string, aggregation: InsightsAggregation) => {
    userInteractedRef.current = true;
    setEvents((current) => current.map((e) => (e.name === name ? { ...e, aggregation } : e)));
  };

  const removeEvent = (name: string) => {
    userInteractedRef.current = true;
    setEvents((current) => current.filter((e) => e.name !== name));
  };

  const revealFilters = () => {
    userInteractedRef.current = true;
    setShowFilters(true);
    if (filters.length === 0) {
      setFilters([{ property: propertyNames[0] ?? '', op: 'eq', value: '' }]);
    }
  };

  const handleFiltersChange = (next: InsightsFilter[]) => {
    userInteractedRef.current = true;
    setFilters(next);
    if (next.length === 0) setShowFilters(false);
  };

  const removeBreakdown = () => {
    userInteractedRef.current = true;
    setShowBreakdown(false);
    setBreakdownProperty('');
  };

  const removeSegment = () => {
    userInteractedRef.current = true;
    setShowSegment(false);
    setSegmentId(null);
  };

  const setIntervalFromInput = (next: InsightsInterval) => {
    userInteractedRef.current = true;
    setInterval(next);
  };

  const setBreakdownPropertyFromInput = (next: string) => {
    userInteractedRef.current = true;
    setBreakdownProperty(next);
  };

  const setSegmentIdFromInput = (next: string | null) => {
    userInteractedRef.current = true;
    setSegmentId(next);
  };

  const setChartTypeFromInput = (next: InsightsChartType) => {
    userInteractedRef.current = true;
    setChartType(next);
  };

  const queryDefinition: InsightsQueryDefinition = useMemo(() => {
    const def: InsightsQueryDefinition = {
      events,
      date_range: { from: dateFrom, to: dateTo },
      interval,
      filters: mergeGlobalFilters(filters, globalFilters),
    };
    if (breakdownProperty) def.breakdown = { property: breakdownProperty };
    if (segmentId) def.cohort_id = segmentId;
    return def;
  }, [events, dateFrom, dateTo, interval, filters, globalFilters, breakdownProperty, segmentId]);

  // A real (non-hydration) change to the global date range also counts as "the user acted" — the
  // preset control lives outside this component, so there's no handler here to flag directly.
  const seenRangeRef = useRef({ from: dateFrom, to: dateTo });
  useEffect(() => {
    if (seenRangeRef.current.from !== dateFrom || seenRangeRef.current.to !== dateTo) {
      seenRangeRef.current = { from: dateFrom, to: dateTo };
      userInteractedRef.current = true;
    }
  }, [dateFrom, dateTo]);

  // Write the current builder state back to the `s` param whenever it changes — but only once
  // there's something worth sharing (see `userInteractedRef` above). Debounced + `replace: true`
  // inside `pushState`, so rapid edits coalesce into a single history entry.
  useEffect(() => {
    if (!userInteractedRef.current) return;
    const next: InsightsAnalysisState = {
      v: 1,
      from: dateFrom,
      to: dateTo,
      segmentId,
      events,
      interval,
      filters: cleanFilters(filters),
      breakdownProperty: breakdownProperty || undefined,
      chartType,
    };
    pushState(next);
  }, [events, interval, filters, breakdownProperty, segmentId, chartType, dateFrom, dateTo, pushState]);

  // Auto-run: the result tracks the builder without a "Run" click. The previous chart stays on
  // screen while a new one loads, so the result area never flickers back to empty.
  const canRun = events.length > 0 && Boolean(dateFrom) && Boolean(dateTo);
  useAutoRun({
    key: JSON.stringify(queryDefinition),
    enabled: canRun,
    run: () => runInsights.mutate(queryDefinition, { onSuccess: setResult }),
  });

  // KPI summary row: the same query re-run over the immediately-preceding equal-length window, so
  // the headline numbers can show a period-over-period delta alongside the already-run result.
  const prevRange = previousRange(dateFrom, dateTo);
  const previousDefinition: InsightsQueryDefinition = useMemo(
    () => ({ ...queryDefinition, date_range: { from: prevRange.from, to: prevRange.to } }),
    [queryDefinition, prevRange.from, prevRange.to],
  );
  const previousTotals = useInsightsQuery(projectId, previousDefinition, canRun);

  // NOTE: there is deliberately no "Unique users" KPI here. `unique_users` series are per-interval
  // distinct-user counts, so summing them across buckets (as `sumSeries` does for the additive
  // "Total" count) would double-count returning users and wildly overstate the range total. There
  // is no clean single-value source for a range-wide unique count from bucketed insights data, so
  // the honest choice is to not show one rather than show a wrong number.
  const currentTotal = result ? sumSeries(result.series) : 0;
  const previousTotal = previousTotals.data ? sumSeries(previousTotals.data.series) : 0;
  const totalDelta =
    result && previousTotals.data ? pctDelta(currentTotal, previousTotal) : undefined;

  return (
    <PageShell
      projectId={projectId}
      title="Insights"
      description="Pick an event to see its trend. Refine with a date range, grouping, or filters when you need to."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Insights' }]}
      dateRangeControl={<DateRangeControl />}
      actions={
        <>
          <CopyLinkButton />
          <SaveAsReportButton
            projectId={projectId}
            kind="insights"
            definition={queryDefinition}
            disabled={events.length === 0}
          />
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {projectHasNoEvents ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium">No events tracked yet</p>
              <p className="mt-1 text-sm text-text-muted">
                Once your app sends events they’ll appear here, ready to explore.
              </p>
            </div>
          ) : (
            <>
              {events.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {events.map((ev, index) => (
                    <li
                      key={ev.name}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg/40 p-2.5"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForIndex(index) }}
                      />
                      <span className="flex-1 truncate text-sm font-medium">{ev.name}</span>
                      <label className="sr-only" htmlFor={`measure-${ev.name}`}>
                        Measure for {ev.name}
                      </label>
                      <select
                        id={`measure-${ev.name}`}
                        value={ev.aggregation}
                        onChange={(e) =>
                          updateMeasure(ev.name, e.target.value as InsightsAggregation)
                        }
                        className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                      >
                        <option value="total">{MEASURE_LABELS.total}</option>
                        <option value="unique_users">{MEASURE_LABELS.unique_users}</option>
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${ev.name}`}
                        onClick={() => removeEvent(ev.name)}
                      >
                        ✕
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <EventPicker
                  options={eventOptions}
                  onSelect={addEvent}
                  exclude={selectedNames}
                  isLoading={metaEvents.isPending}
                  disabled={events.length >= MAX_EVENTS}
                  comboLabel="Add event"
                  triggerLabel={events.length === 0 ? 'Add an event' : 'Add event'}
                  emptyLabel="No events tracked yet."
                />
                {events.length >= MAX_EVENTS && (
                  <p className="mt-1 text-xs text-text-muted">Up to {MAX_EVENTS} events per query.</p>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t border-border pt-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label htmlFor="insights-interval" className="text-sm text-text-muted">
                    Show by
                  </label>
                  <select
                    id="insights-interval"
                    aria-label="Show by"
                    value={interval}
                    onChange={(e) => setIntervalFromInput(e.target.value as InsightsInterval)}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    {INTERVAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
                  {!showFilters && <AddControlButton label="Filter" onClick={revealFilters} />}
                  {!showBreakdown && (
                    <AddControlButton
                      label="Group by"
                      onClick={() => {
                        userInteractedRef.current = true;
                        setShowBreakdown(true);
                      }}
                    />
                  )}
                  {!showSegment && (
                    <AddControlButton
                      label="Segment"
                      onClick={() => {
                        userInteractedRef.current = true;
                        setShowSegment(true);
                      }}
                    />
                  )}
                </div>

                {showFilters && (
                  <FilterRows
                    idPrefix="insights-filter"
                    ariaLabel="Filter"
                    filters={filters}
                    onChange={handleFiltersChange}
                    propertyNames={propertyNames}
                    projectId={projectId}
                  />
                )}

                {showBreakdown && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label htmlFor="insights-breakdown" className="text-sm font-medium">
                        Group by
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Remove group by"
                        onClick={removeBreakdown}
                      >
                        Remove
                      </Button>
                    </div>
                    <select
                      id="insights-breakdown"
                      aria-label="Group by"
                      value={breakdownProperty}
                      onChange={(e) => setBreakdownPropertyFromInput(e.target.value)}
                      className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                    >
                      <option value="">No group</option>
                      {propertyNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {showSegment && (
                  <div className="flex items-end gap-2">
                    <SegmentPicker
                      projectId={projectId}
                      value={segmentId}
                      onChange={setSegmentIdFromInput}
                      id="insights-segment"
                      label="Segment"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove segment"
                      onClick={removeSegment}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {runInsights.isError && (
        <p role="alert" className="text-danger">
          {runInsights.error instanceof ApiError
            ? runInsights.error.problem.title
            : 'Failed to run the query'}
        </p>
      )}

      {!projectHasNoEvents && (
        <div className="flex flex-col gap-6">
          {runInsights.isPending && (
            <p role="status" className="text-sm text-text-muted">
              Updating…
            </p>
          )}

          {result && (
            <SectionGrid min={200}>
              <KpiTile
                label="Total"
                value={currentTotal}
                hint="Selected range"
                delta={totalDelta !== undefined ? { pct: totalDelta } : undefined}
                loading={previousTotals.isPending}
              />
            </SectionGrid>
          )}

          <ChartCard
            title="Trend"
            state={!result ? 'loading' : result.series.length === 0 ? 'empty' : 'ready'}
            emptyText="No data for this query yet."
            exportImageName="insights-trend"
          >
            {result && result.series.length > 0 && (
              <InsightsChart
                series={result.series}
                eventOrder={events.map((e) => e.name)}
                chartType={chartType}
                onChartTypeChange={setChartTypeFromInput}
              />
            )}
          </ChartCard>
        </div>
      )}
    </PageShell>
  );
}
