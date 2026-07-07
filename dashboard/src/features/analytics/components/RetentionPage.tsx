import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { ApiError } from '../../../lib/api/problem';
import type {
  InsightsFilter,
  RetentionInterval,
  RetentionQueryDefinition,
  RetentionResponse,
} from '../../../lib/api/types';
import { INSIGHTS_FILTER_OPS, RETENTION_INTERVALS } from '../../../lib/api/types';
import { useEngagement, useMetaEvents, useMetaProperties, useRunRetention } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { formatPercent } from '../format';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { ChartCard } from './charts/ChartCard';
import { ComparisonTrend } from './charts/ComparisonTrend';
import { CopyLinkButton } from './CopyLinkButton';
import { KpiTile } from './charts/KpiTile';
import { RetentionChart } from './RetentionChart';
import { PageShell } from '../../../components/layout/PageShell';
import { SaveAsReportButton } from './report-actions';
import { SegmentPicker } from './SegmentPicker';
import { cleanFilters, FilterRows } from './builder-controls';
import { EventSelectField, presetIdForRange } from './explore-controls';
import type { AnalysisStateEnvelope } from '../share-state';
import { useUrlAnalysisState } from '../share-state';

const INTERVAL_LABELS: Record<RetentionInterval, string> = {
  day: 'Day',
  week: 'Week',
};

/**
 * Retention's shareable-URL shape (feat-01 §3.1/§6 T2) — mirrors the builder state above, plus the
 * `from`/`to` range seed. Every field optional: a link may carry any subset (or none, if
 * malformed) and {@link sanitizeRetentionUrlState} fills in the current defaults per field.
 */
export interface RetentionAnalysisState extends AnalysisStateEnvelope {
  from?: string;
  to?: string;
  segmentId?: string | null;
  bornEvent?: string;
  bornFilters?: InsightsFilter[];
  returnEvent?: string;
  returnFilters?: InsightsFilter[];
  interval?: RetentionInterval;
  periods?: number;
}

const DEFAULT_URL_STATE: RetentionAnalysisState = { v: 1 };

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sanitizeFilters(value: unknown, propertyNames: string[]): InsightsFilter[] {
  if (!Array.isArray(value)) return [];
  const filters: InsightsFilter[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { property, op, value: filterValue } = candidate as Record<string, unknown>;
    if (typeof property !== 'string' || !propertyNames.includes(property)) continue;
    if (typeof op !== 'string' || !INSIGHTS_FILTER_OPS.includes(op as InsightsFilter['op']))
      continue;
    if (filterValue !== undefined && typeof filterValue !== 'string') continue;
    filters.push({ property, op: op as InsightsFilter['op'], value: filterValue as string | undefined });
  }
  return filters;
}

interface SanitizedRetentionState {
  bornEvent: string;
  bornFilters: InsightsFilter[];
  returnEvent: string;
  returnFilters: InsightsFilter[];
  interval: RetentionInterval;
  periods: number;
  segmentId: string | null;
  from?: string;
  to?: string;
}

/**
 * Validates a decoded `s` param field-by-field, dropping anything that doesn't correspond to a
 * real event/property, isn't a recognized enum value, or isn't the right JS type — a bad/stale
 * link never throws, it just silently loses the offending piece. Returns `null` when there isn't
 * even a usable born event, since a retention query needs one to mean anything.
 */
function sanitizeRetentionUrlState(
  urlState: RetentionAnalysisState,
  { eventOptions, propertyNames }: { eventOptions: string[]; propertyNames: string[] },
): SanitizedRetentionState | null {
  const raw = urlState as unknown as Record<string, unknown>;

  const bornEvent = typeof raw.bornEvent === 'string' && eventOptions.includes(raw.bornEvent)
    ? raw.bornEvent
    : '';
  if (!bornEvent) return null;

  const returnEvent =
    typeof raw.returnEvent === 'string' && eventOptions.includes(raw.returnEvent)
      ? raw.returnEvent
      : '';

  const bornFilters = sanitizeFilters(raw.bornFilters, propertyNames);
  const returnFilters = sanitizeFilters(raw.returnFilters, propertyNames);

  const interval =
    typeof raw.interval === 'string' && RETENTION_INTERVALS.includes(raw.interval as RetentionInterval)
      ? (raw.interval as RetentionInterval)
      : 'day';

  const periods =
    typeof raw.periods === 'number' && Number.isFinite(raw.periods) && raw.periods >= 1 && raw.periods <= 30
      ? raw.periods
      : 14;

  // A stale/deleted segment id can't be told apart from "not loaded yet" here (SegmentPicker owns
  // the live cohort list) — only the shape is validated; an unknown id simply shows unselected.
  const segmentId = typeof raw.segmentId === 'string' ? raw.segmentId : null;

  const from = isDateString(raw.from) ? raw.from : undefined;
  const to = isDateString(raw.to) ? raw.to : undefined;

  return { bornEvent, bornFilters, returnEvent, returnFilters, interval, periods, segmentId, from, to };
}

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop in one place. */
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

export function RetentionPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/retention' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runRetention = useRunRetention(projectId);
  // Time-scoped by the global range (Phase 2): seeds the builder's query and is also the window
  // for the always-on stickiness surface below; surfaced via `<DateRangeControl/>` in the header.
  const { from: dateFrom, to: dateTo, setRange } = useDateRange();
  const engagement = useEngagement(projectId, dateFrom, dateTo, 'day');
  // Global Filters Bar (feat-02): AND-joins onto the born/return event filters right before
  // sending. The stickiness surface below is engagement-driven and not yet filter-aware (T2).
  const { filters: globalFilters } = useGlobalFilters();

  // Shareable Analysis URLs (feat-01): the `?s=` param is this page's serialized builder state.
  // `urlState` only changes identity when the param itself changes (mount, or back/forward).
  const { urlState, pushState } = useUrlAnalysisState<RetentionAnalysisState>(DEFAULT_URL_STATE);

  const [bornEvent, setBornEvent] = useState('');
  const [bornFilters, setBornFilters] = useState<InsightsFilter[]>([]);
  const [returnEvent, setReturnEvent] = useState('');
  const [returnFilters, setReturnFilters] = useState<InsightsFilter[]>([]);
  const [interval, setInterval] = useState<RetentionInterval>('day');
  const [periods, setPeriods] = useState(14);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [result, setResult] = useState<RetentionResponse | null>(null);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];
  const stickinessRows = (engagement.data?.stickiness ?? []).map((p) => ({ t: p.t, value: p.value }));
  const averageRetention = result?.averages.find((a) => a.period === 1)?.rate;

  // Flips true the moment the builder reflects something worth sharing — either a real user edit,
  // or the state we just hydrated from a link — so `pushState` only ever fires once there's a
  // meaningful view to write back (never on the bare "no param yet" initial render, per §4).
  const userInteractedRef = useRef(false);

  const setBornEventFromInput = (next: string) => {
    userInteractedRef.current = true;
    setBornEvent(next);
  };

  const setBornFiltersFromInput = (next: InsightsFilter[]) => {
    userInteractedRef.current = true;
    setBornFilters(next);
  };

  const setReturnEventFromInput = (next: string) => {
    userInteractedRef.current = true;
    setReturnEvent(next);
  };

  const setReturnFiltersFromInput = (next: InsightsFilter[]) => {
    userInteractedRef.current = true;
    setReturnFilters(next);
  };

  const setIntervalFromInput = (next: RetentionInterval) => {
    userInteractedRef.current = true;
    setInterval(next);
  };

  const setPeriodsFromInput = (next: number) => {
    userInteractedRef.current = true;
    setPeriods(next);
  };

  const setSegmentIdFromInput = (next: string | null) => {
    userInteractedRef.current = true;
    setSegmentId(next);
  };

  // On first load: hydrate from a shared `s` link (validating field-by-field, dropping anything
  // that doesn't correspond to a real event/property — see `sanitizeRetentionUrlState`) once both
  // metadata queries are in, so event/property names can actually be checked. Falls back to the
  // normal empty builder when there's no usable `s` state. Only ever runs once, so clearing the
  // builder afterwards stays cleared.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !metaEvents.isSuccess || !metaProperties.isSuccess) return;
    didInit.current = true;

    const hydrated = sanitizeRetentionUrlState(urlState, { eventOptions, propertyNames });
    if (!hydrated) return;

    setBornEvent(hydrated.bornEvent);
    setBornFilters(hydrated.bornFilters);
    setReturnEvent(hydrated.returnEvent);
    setReturnFilters(hydrated.returnFilters);
    setInterval(hydrated.interval);
    setPeriods(hydrated.periods);
    if (hydrated.segmentId) setSegmentId(hydrated.segmentId);
    if (hydrated.from && hydrated.to) {
      setRange(hydrated.from, hydrated.to, presetIdForRange(hydrated.from, hydrated.to));
    }
    // Self-healing (§4): the next edit rewrites a clean `s` reflecting the sanitized state.
    userInteractedRef.current = true;

    // Opening a shared link reproduces AND runs the exact view (feat-01 §2) — built directly from
    // the sanitized fields (not the not-yet-committed state) so this first run is exact.
    const def: RetentionQueryDefinition = {
      born_event: { name: hydrated.bornEvent, filters: mergeGlobalFilters(hydrated.bornFilters, globalFilters) },
      date_range: { from: hydrated.from ?? dateFrom, to: hydrated.to ?? dateTo },
      interval: hydrated.interval,
      periods: hydrated.periods,
    };
    if (hydrated.returnEvent) {
      def.return_event = {
        name: hydrated.returnEvent,
        filters: mergeGlobalFilters(hydrated.returnFilters, globalFilters),
      };
    }
    if (hydrated.segmentId) def.cohort_id = hydrated.segmentId;
    runRetention.mutate(def, { onSuccess: setResult });
  }, [
    metaEvents.isSuccess,
    metaProperties.isSuccess,
    urlState,
    eventOptions,
    propertyNames,
    dateFrom,
    dateTo,
    globalFilters,
    setRange,
    runRetention,
  ]);

  const queryDefinition: RetentionQueryDefinition = useMemo(() => {
    const def: RetentionQueryDefinition = {
      born_event: { name: bornEvent, filters: mergeGlobalFilters(bornFilters, globalFilters) },
      date_range: { from: dateFrom, to: dateTo },
      interval,
      periods,
    };
    // return_event is omitted when blank — §15: defaults to born_event server-side.
    if (returnEvent.trim()) {
      def.return_event = {
        name: returnEvent.trim(),
        filters: mergeGlobalFilters(returnFilters, globalFilters),
      };
    }
    if (segmentId) def.cohort_id = segmentId;
    return def;
  }, [
    bornEvent,
    bornFilters,
    returnEvent,
    returnFilters,
    dateFrom,
    dateTo,
    interval,
    periods,
    segmentId,
    globalFilters,
  ]);

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
    const next: RetentionAnalysisState = {
      v: 1,
      from: dateFrom,
      to: dateTo,
      segmentId,
      bornEvent,
      bornFilters: cleanFilters(bornFilters),
      returnEvent: returnEvent || undefined,
      returnFilters: cleanFilters(returnFilters),
      interval,
      periods,
    };
    pushState(next);
  }, [
    bornEvent,
    bornFilters,
    returnEvent,
    returnFilters,
    interval,
    periods,
    segmentId,
    dateFrom,
    dateTo,
    pushState,
  ]);

  const canRun =
    Boolean(bornEvent.trim()) && Boolean(dateFrom) && Boolean(dateTo) && !runRetention.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runRetention.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <PageShell
      projectId={projectId}
      title="Retention"
      description="Measure how many users come back over time after a first action."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Retention' }]}
      dateRangeControl={<DateRangeControl />}
      actions={<CopyLinkButton />}
    >
      <Card>
        <CardHeader>
          <CardTitle>Retention builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <EventSelectField
              label="Born event"
              value={bornEvent}
              onChange={setBornEventFromInput}
              options={eventOptions}
              isLoading={metaEvents.isPending}
              placeholder="Select event…"
            />
            <FilterRows
              idPrefix="retention-born-filter"
              ariaLabel="Born event filter"
              filters={bornFilters}
              onChange={setBornFiltersFromInput}
              propertyNames={propertyNames}
              projectId={projectId}
            />
          </div>

          <div className="flex flex-col gap-2">
            <EventSelectField
              label="Return event"
              value={returnEvent}
              onChange={setReturnEventFromInput}
              options={eventOptions}
              isLoading={metaEvents.isPending}
              placeholder="Defaults to the born event"
              allowClear
            />
            <FilterRows
              idPrefix="retention-return-filter"
              ariaLabel="Return event filter"
              filters={returnFilters}
              onChange={setReturnFiltersFromInput}
              propertyNames={propertyNames}
              projectId={projectId}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="retention-interval" className="mb-1 block text-sm font-medium">
                Interval
              </label>
              <select
                id="retention-interval"
                value={interval}
                onChange={(e) => setIntervalFromInput(e.target.value as RetentionInterval)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {RETENTION_INTERVALS.map((value) => (
                  <option key={value} value={value}>
                    {INTERVAL_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="retention-periods" className="mb-1 block text-sm font-medium">
                Periods
              </label>
              <input
                id="retention-periods"
                type="number"
                min={1}
                max={30}
                value={periods}
                onChange={(e) => setPeriodsFromInput(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
          </div>

          <SegmentPicker projectId={projectId} value={segmentId} onChange={setSegmentIdFromInput} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={!canRun}>
              {runRetention.isPending ? 'Running…' : 'Run'}
            </Button>
            <SaveAsReportButton
              projectId={projectId}
              kind="retention"
              definition={queryDefinition}
              disabled={!bornEvent.trim()}
            />
          </div>
        </CardContent>
      </Card>

      {runRetention.isError && (
        <p role="alert" className="text-danger">
          {runRetention.error instanceof ApiError
            ? runRetention.error.problem.title
            : 'Failed to run retention'}
        </p>
      )}

      {result && result.cohorts.length === 0 && (
        <p className="text-text-muted">No cohorts for this query yet.</p>
      )}

      {result && result.cohorts.length > 0 && (
        <div className="flex flex-col gap-6">
          <SectionGrid min={220}>
            <KpiTile
              label="Average retention"
              value={averageRetention !== undefined ? formatPercent(averageRetention) : '—'}
              hint="Period 1, size-weighted across cohorts"
            />
          </SectionGrid>

          <ChartCard title="Retention" description="Cohort retention heatmap by period.">
            <RetentionChart cohorts={result.cohorts} averages={result.averages} interval={interval} />
          </ChartCard>
        </div>
      )}

      <ChartCard
        title="Stickiness (DAU/MAU)"
        description="Daily active ÷ monthly active users over the selected range — how often users come back."
        state={chartState(engagement.isPending, engagement.isError, stickinessRows.length === 0)}
      >
        <ComparisonTrend
          current={stickinessRows}
          xKey="t"
          valueKey="value"
          label="Stickiness"
          ariaLabel="Stickiness trend"
        />
      </ChartCard>
    </PageShell>
  );
}
