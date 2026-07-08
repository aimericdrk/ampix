import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
  type InsightsSeries,
} from '../../../lib/api/types';
import { useCohorts, useInsightsQuery, useMetaEvents, useMetaProperties, useRunInsights } from '../api';
import { detectAnomalies } from '../anomaly';
import { useAnnotations } from '../annotations';
import { DateRangeControl, useDateRange } from '../date-range';
import { pctDelta, previousRange, seriesTrendRows, sumSeries } from '../derive';
import { formatExactNumber } from '../format';
import { computeFormulaSeries, type FormulaOperator } from '../formula';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { colorForIndex } from '../palette';
import { combineSegmentSeries } from '../segment-compare';
import type { AnalysisStateEnvelope } from '../share-state';
import { useUrlAnalysisState } from '../share-state';
import { AddToDashboardButton } from './AddToDashboardButton';
import { AnnotationsManager } from './AnnotationsManager';
import { AskBar } from './AskBar';
import { CompareControl, type CompareRange } from './CompareControl';
import { AnomalyCallout } from './charts/AnomalyCallout';
import { ChartCard } from './charts/ChartCard';
import { ComparisonTrend } from './charts/ComparisonTrend';
import { CopyLinkButton } from './CopyLinkButton';
import { FormulaControl, FORMULA_OPERATOR_SYMBOLS } from './FormulaControl';
import { KpiTile } from './charts/KpiTile';
import { INSIGHTS_CHART_TYPES, InsightsChart, type InsightsChartType } from './InsightsChart';
import { PageShell } from '../../../components/layout/PageShell';
import { SaveAsReportButton } from './report-actions';
import { SegmentCompareControl, segmentLabel } from './SegmentCompareControl';
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

/**
 * "Ask your data" (feat-17 §3.2): flattens a §14 {@link InsightsQueryDefinition} (the backend's Ask
 * response shape) into the same envelope {@link sanitizeUrlState} already knows how to validate for
 * the shareable `?s=` link — so hydrating from an Ask result reuses that exact field-by-field
 * validation (dropping any invented event/property name the model produced) instead of duplicating it.
 */
function definitionToUrlState(definition: InsightsQueryDefinition): InsightsAnalysisState {
  return {
    v: 1,
    events: definition.events,
    interval: definition.interval,
    filters: definition.filters,
    breakdownProperty: definition.breakdown?.property,
    segmentId: definition.cohort_id ?? null,
    from: definition.date_range.from,
    to: definition.date_range.to,
  };
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

// --- Formula / Ratio Metrics (feat-05) -----------------------------------------------------

/** `null` (ratio's divide-by-zero) reads as "—", never `Infinity`/`NaN`; a percent appends `%`. */
function formatFormulaValue(value: number | null, asPercent: boolean): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 100) / 100;
  return asPercent ? `${rounded}%` : formatExactNumber(rounded);
}

interface FormulaTableRow {
  t: string;
  a: number;
  b: number;
  formula: number | null;
}

/** Re-derives the zero-filled A/B values alongside the already-computed formula points, for the
 * accessible A/B/formula data table (feat-05 §3 "Accessible data table with the A, B, and formula
 * columns"). Reuses the formula points' timestamp order/union rather than recomputing it. */
function buildFormulaRows(
  a: InsightsSeries | undefined,
  b: InsightsSeries | undefined,
  formulaData: Array<{ t: string; value: number | null }>,
): FormulaTableRow[] {
  const aPoints = new Map((a?.data ?? []).map((point) => [point.t, point.value]));
  const bPoints = new Map((b?.data ?? []).map((point) => [point.t, point.value]));
  return formulaData.map((row) => ({
    t: row.t,
    a: aPoints.get(row.t) ?? 0,
    b: bPoints.get(row.t) ?? 0,
    formula: row.value,
  }));
}

const FORMULA_TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
};

const FORMULA_AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };

/** The single derived line for Formula mode. Recharts' `Line` breaks (never interpolates through)
 * a `null` point by default, so a ratio's divide-by-zero bucket renders as a genuine gap. */
function FormulaTrendChart({
  data,
  asPercent,
  ariaLabel,
}: {
  data: Array<{ t: string; value: number | null }>;
  asPercent: boolean;
  ariaLabel: string;
}) {
  const color = colorForIndex(0);
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height: 320, backgroundColor: 'var(--chart-surface)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="t" tick={FORMULA_AXIS_TICK} stroke="var(--border)" />
          <YAxis
            tick={FORMULA_AXIS_TICK}
            stroke="var(--border)"
            tickFormatter={(value: number) => (asPercent ? `${value}%` : formatExactNumber(value))}
          />
          <Tooltip
            contentStyle={FORMULA_TOOLTIP_STYLE}
            labelStyle={{ color: 'var(--text-muted)' }}
            formatter={(value: unknown) => [
              typeof value === 'number' ? formatFormulaValue(value, asPercent) : String(value ?? '—'),
              'Formula',
            ]}
          />
          <Line
            type="monotone"
            dataKey="value"
            name="Formula"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, fill: color, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The accessible A/B/formula data table (feat-05 §3), always rendered alongside the chart. */
function FormulaTable({
  rows,
  labelA,
  labelB,
  asPercent,
}: {
  rows: FormulaTableRow[];
  labelA: string;
  labelB: string;
  asPercent: boolean;
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Formula trend data table</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            Date
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {labelA}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {labelB}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Formula
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.t} className="border-b border-border">
            <td className="py-2">{row.t}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(row.a)}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(row.b)}</td>
            <td className="py-2 text-right tabular-nums">
              {formatFormulaValue(row.formula, asPercent)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InsightsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/insights' });
  const navigate = useNavigate();
  // "Ask your data" (feat-17 §3.2): the command palette navigates here with a one-shot `ask` flag
  // so the AskBar can be focused on arrival; `strict: false` mirrors `useUrlAnalysisState` below.
  const search = useSearch({ strict: false }) as { ask?: boolean };
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runInsights = useRunInsights(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Insights shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo, setRange } = useDateRange();
  // Global Filters Bar (feat-02): AND-joins onto this page's own filters right before sending —
  // never mutates the local filter rows, so the builder UI still reflects only what the user set.
  const { filters: globalFilters } = useGlobalFilters();
  // Chart Annotations (feat-08): one shared per-project note set, shown on every trend chart.
  const { annotations, add: addAnnotation, remove: removeAnnotation } = useAnnotations(projectId);

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
  // "Ask your data" (feat-17 §3.2): the last question a built query came from, for the "Built
  // from: <question> — edit below" note; cleared as soon as the user edits the builder by hand.
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Advanced options stay tucked away until asked for (progressive disclosure).
  const [showFilters, setShowFilters] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showSegment, setShowSegment] = useState(false);

  // Segment Comparison (feat-04 §3.1): a separate, additive control from the single-segment
  // `SegmentPicker` above. Starts at just "All users" (id `null`) — one selection is still the
  // ordinary single-series view; compare mode only turns on once a 2nd segment joins the list
  // (§4 "0-1 segments selected -> normal single-series Insights").
  const [showCompare, setShowCompare] = useState(false);
  const [compareSegments, setCompareSegments] = useState<Array<string | null>>([null]);
  const cohorts = useCohorts(projectId);
  const cohortNameById = useMemo(
    () => new Map((cohorts.data?.cohorts ?? []).map((c) => [c.id, c.name])),
    [cohorts.data],
  );
  const compareModeActive = showCompare && compareSegments.length >= 2;

  // Date-range Compare (feat-06 §3): a separate, additive control from Segment Comparison above —
  // `compareRange` is `null` (Off) unless the user has chosen a preset or a valid custom range via
  // `CompareControl`. Only meaningful for the single-series trend below (mutually exclusive, like
  // Segment Comparison and Formula mode, with each other's result presentation).
  const [compareRange, setCompareRange] = useState<CompareRange | null>(null);
  const hasCompareRange = compareRange !== null;

  // Formula / Ratio Metrics (feat-05 §3): a separate 2-metric builder from the normal Events list
  // above — a formula always needs exactly A and B, each with its own aggregation, independent of
  // however many events the normal builder happens to have. Mutually exclusive with the normal
  // trend AND with Segment Comparison (whichever query the page runs, only one result renders).
  const [showFormula, setShowFormula] = useState(false);
  const [formulaA, setFormulaA] = useState<InsightsEventQuery>({ name: '', aggregation: 'total' });
  const [formulaB, setFormulaB] = useState<InsightsEventQuery>({ name: '', aggregation: 'total' });
  const [formulaOp, setFormulaOp] = useState<FormulaOperator>('ratio');
  const [formulaAsPercent, setFormulaAsPercent] = useState(false);
  const formulaModeActive = showFormula && Boolean(formulaA.name) && Boolean(formulaB.name);

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

  // "Ask your data" (feat-17 §3.2): a one-shot arrival from the command palette focuses the
  // AskBar, then strips the `ask` flag so a reload/back-nav doesn't refocus it again.
  useEffect(() => {
    if (!search.ask) return;
    askInputRef.current?.focus();
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, ask: undefined }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }, [search.ask, navigate]);

  /**
   * "Ask your data" (feat-17 §3.2): hydrates the builder from the model-derived definition using
   * the exact same field-by-field validation as the shareable `?s=` link (see
   * {@link definitionToUrlState} + `sanitizeUrlState`) — never trusting an invented event/property
   * name outright. `useAutoRun` below re-runs on its own once `queryDefinition` reflects the change.
   */
  const applyDefinition = (definition: InsightsQueryDefinition, question: string) => {
    const hydrated = sanitizeUrlState(definitionToUrlState(definition), { eventOptions, propertyNames });
    if (!hydrated) {
      setAskedQuestion(null);
      return;
    }

    userInteractedRef.current = true;
    setEvents(hydrated.events);
    setInterval(hydrated.interval);
    setFilters(hydrated.filters);
    setShowFilters(hydrated.filters.length > 0);
    setBreakdownProperty(hydrated.breakdownProperty);
    setShowBreakdown(Boolean(hydrated.breakdownProperty));
    setSegmentId(hydrated.segmentId);
    setShowSegment(Boolean(hydrated.segmentId));
    if (hydrated.from && hydrated.to) {
      setRange(hydrated.from, hydrated.to, presetIdForRange(hydrated.from, hydrated.to));
    }
    setAskedQuestion(question);
  };

  // Manual builder edits (feat-17 §3.2): dismiss the "Built from: <question>" note the moment the
  // user takes the query back over — it only applies to the exact query the model just built.
  const clearAskedQuestion = () => setAskedQuestion(null);

  const addEvent = (name: string) => {
    if (events.length >= MAX_EVENTS || events.some((e) => e.name === name)) return;
    userInteractedRef.current = true;
    clearAskedQuestion();
    setEvents((current) => [...current, { name, aggregation: 'total' }]);
  };

  const updateMeasure = (name: string, aggregation: InsightsAggregation) => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setEvents((current) => current.map((e) => (e.name === name ? { ...e, aggregation } : e)));
  };

  const removeEvent = (name: string) => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setEvents((current) => current.filter((e) => e.name !== name));
  };

  const revealFilters = () => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setShowFilters(true);
    if (filters.length === 0) {
      setFilters([{ property: propertyNames[0] ?? '', op: 'eq', value: '' }]);
    }
  };

  const handleFiltersChange = (next: InsightsFilter[]) => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setFilters(next);
    if (next.length === 0) setShowFilters(false);
  };

  const removeBreakdown = () => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setShowBreakdown(false);
    setBreakdownProperty('');
  };

  const removeSegment = () => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setShowSegment(false);
    setSegmentId(null);
  };

  const removeCompare = () => {
    setShowCompare(false);
    setCompareSegments([null]);
  };

  // Formula mode isn't part of the shareable `?s=` state yet (feat-05 §4 notes this as a follow-up
  // to coordinate with feat-01), so these don't flip `userInteractedRef` the way the other builder
  // controls do.
  const revealFormula = () => {
    setShowFormula(true);
    if (!formulaA.name) setFormulaA({ name: eventOptions[0] ?? '', aggregation: 'total' });
    if (!formulaB.name) {
      setFormulaB({ name: eventOptions[1] ?? eventOptions[0] ?? '', aggregation: 'total' });
    }
  };

  const removeFormula = () => {
    setShowFormula(false);
    setFormulaA({ name: '', aggregation: 'total' });
    setFormulaB({ name: '', aggregation: 'total' });
    setFormulaOp('ratio');
    setFormulaAsPercent(false);
  };

  const setIntervalFromInput = (next: InsightsInterval) => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setInterval(next);
  };

  const setBreakdownPropertyFromInput = (next: string) => {
    userInteractedRef.current = true;
    clearAskedQuestion();
    setBreakdownProperty(next);
  };

  const setSegmentIdFromInput = (next: string | null) => {
    userInteractedRef.current = true;
    clearAskedQuestion();
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
  // screen while a new one loads, so the result area never flickers back to empty. Suppressed in
  // compare mode — the per-segment queries below replace this single unfiltered/one-segment run so
  // the two presentations never both fetch (feat-04 §3.3 "keep the state coherent"). Also
  // suppressed in Formula mode (feat-05 §3), which runs its own 2-event query below instead.
  const canRun = events.length > 0 && Boolean(dateFrom) && Boolean(dateTo);
  useAutoRun({
    key: JSON.stringify(queryDefinition),
    enabled: canRun && !compareModeActive && !formulaModeActive,
    run: () => runInsights.mutate(queryDefinition, { onSuccess: setResult }),
  });

  // KPI summary row: the same query re-run over the immediately-preceding equal-length window, so
  // the headline numbers can show a period-over-period delta alongside the already-run result.
  // Also suppressed in compare mode (superseded by the per-segment totals below) and Formula mode.
  const prevRange = previousRange(dateFrom, dateTo);
  const previousDefinition: InsightsQueryDefinition = useMemo(
    () => ({ ...queryDefinition, date_range: { from: prevRange.from, to: prevRange.to } }),
    [queryDefinition, prevRange.from, prevRange.to],
  );
  // Off (no explicit compare range): the implicit previous-period KPI comparison runs, exactly as
  // before feat-06. Once the user picks an explicit compare range, that supersedes this one below —
  // no need to run both.
  const previousTotals = useInsightsQuery(
    projectId,
    previousDefinition,
    canRun && !compareModeActive && !formulaModeActive && !hasCompareRange,
  );

  // Date-range Compare (feat-06 §3): the SAME query definition (events/range/interval/filters/
  // segment), re-run over the user-chosen compare range instead of the current one. Only runs in
  // the plain single-series view (never alongside Segment Comparison or Formula mode), and only
  // once a compare range is actually resolved (`CompareControl` emits `null` for Off/invalid).
  const compareDefinition: InsightsQueryDefinition = useMemo(
    () => ({ ...queryDefinition, date_range: compareRange ?? { from: '', to: '' } }),
    [queryDefinition, compareRange],
  );
  const canRunCompare = canRun && !compareModeActive && !formulaModeActive && hasCompareRange;
  const compareResult = useInsightsQuery(projectId, compareDefinition, canRunCompare);

  // Formula / Ratio Metrics (feat-05 §3): ONE query carrying both metrics [A, B] — respecting the
  // same global filters + segment + date range as the normal query — plus the previous-period
  // window for the KPI's period-over-period delta. No breakdown (a formula is exactly 2 metrics).
  const formulaDefinition: InsightsQueryDefinition = useMemo(() => {
    const def: InsightsQueryDefinition = {
      events: [formulaA, formulaB],
      date_range: { from: dateFrom, to: dateTo },
      interval,
      filters: mergeGlobalFilters(filters, globalFilters),
    };
    if (segmentId) def.cohort_id = segmentId;
    return def;
  }, [formulaA, formulaB, dateFrom, dateTo, interval, filters, globalFilters, segmentId]);

  const canRunFormula = formulaModeActive && Boolean(dateFrom) && Boolean(dateTo);
  const formulaResult = useInsightsQuery(projectId, formulaDefinition, canRunFormula);

  const previousFormulaDefinition: InsightsQueryDefinition = useMemo(
    () => ({ ...formulaDefinition, date_range: { from: prevRange.from, to: prevRange.to } }),
    [formulaDefinition, prevRange.from, prevRange.to],
  );
  const previousFormulaResult = useInsightsQuery(
    projectId,
    previousFormulaDefinition,
    canRunFormula,
  );

  /** Matches a requested metric's series in the response by name (falls back to array position so
   * a same-event-for-A-and-B formula, feat-05 §4 "degenerate but valid", still resolves both). */
  function pickFormulaSeries(
    response: InsightsResponse | undefined,
    name: string,
    index: number,
  ): InsightsSeries | undefined {
    if (!response) return undefined;
    return response.series.find((s) => s.name === name) ?? response.series[index];
  }

  const formulaSeriesA = pickFormulaSeries(formulaResult.data, formulaA.name, 0);
  const formulaSeriesB = pickFormulaSeries(formulaResult.data, formulaB.name, 1);
  const formulaComputed = computeFormulaSeries(formulaSeriesA, formulaSeriesB, formulaOp, formulaAsPercent);

  const previousFormulaSeriesA = pickFormulaSeries(previousFormulaResult.data, formulaA.name, 0);
  const previousFormulaSeriesB = pickFormulaSeries(previousFormulaResult.data, formulaB.name, 1);
  const previousFormulaComputed = computeFormulaSeries(
    previousFormulaSeriesA,
    previousFormulaSeriesB,
    formulaOp,
    formulaAsPercent,
  );

  const formulaDelta =
    formulaComputed.total !== null && previousFormulaComputed.total !== null
      ? pctDelta(formulaComputed.total, previousFormulaComputed.total)
      : undefined;

  const formulaRows = buildFormulaRows(formulaSeriesA, formulaSeriesB, formulaComputed.data);

  // Segment Comparison (feat-04 §3.2): the SAME query definition (events/range/interval/filters/
  // breakdown, global filters already merged), run once per selected segment with that segment's
  // own `cohort_id` (omitted for "All users"). A fixed number of hook calls (never a variable
  // count) respects the Rules of Hooks — each slot is simply gated on whether compare mode has a
  // segment at that position.
  const compareBaseDefinition: InsightsQueryDefinition = useMemo(() => {
    const def: InsightsQueryDefinition = {
      events,
      date_range: { from: dateFrom, to: dateTo },
      interval,
      filters: mergeGlobalFilters(filters, globalFilters),
    };
    if (breakdownProperty) def.breakdown = { property: breakdownProperty };
    return def;
  }, [events, dateFrom, dateTo, interval, filters, globalFilters, breakdownProperty]);

  const definitionForSegment = (id: string | null): InsightsQueryDefinition =>
    id ? { ...compareBaseDefinition, cohort_id: id } : compareBaseDefinition;

  const COMPARE_SLOT_COUNT = 4;
  const slotEnabled = [0, 1, 2, 3].map(
    (i) => compareModeActive && !formulaModeActive && i < compareSegments.length && canRun,
  );
  const compareSlot0 = useInsightsQuery(
    projectId,
    definitionForSegment(compareSegments[0] ?? null),
    slotEnabled[0],
  );
  const compareSlot1 = useInsightsQuery(
    projectId,
    definitionForSegment(compareSegments[1] ?? null),
    slotEnabled[1],
  );
  const compareSlot2 = useInsightsQuery(
    projectId,
    definitionForSegment(compareSegments[2] ?? null),
    slotEnabled[2],
  );
  const compareSlot3 = useInsightsQuery(
    projectId,
    definitionForSegment(compareSegments[3] ?? null),
    slotEnabled[3],
  );
  const compareSlots = [compareSlot0, compareSlot1, compareSlot2, compareSlot3];

  // Block-until-all (§4): the comparison renders as one coherent view once every active segment has
  // resolved, rather than trickling series in one at a time.
  const compareLoading =
    compareModeActive && slotEnabled.some((enabled, i) => enabled && compareSlots[i]?.isPending);

  const compareInputs = compareModeActive
    ? compareSegments
        .slice(0, COMPARE_SLOT_COUNT)
        .map((id, i) => ({ name: segmentLabel(id, cohortNameById), response: compareSlots[i]?.data }))
    : [];
  const combinedCompare = combineSegmentSeries(compareInputs);
  const compareBaselineTotal = combinedCompare.totals[0]?.total ?? 0;

  // NOTE: there is deliberately no "Unique users" KPI here. `unique_users` series are per-interval
  // distinct-user counts, so summing them across buckets (as `sumSeries` does for the additive
  // "Total" count) would double-count returning users and wildly overstate the range total. There
  // is no clean single-value source for a range-wide unique count from bucketed insights data, so
  // the honest choice is to not show one rather than show a wrong number.
  const currentTotal = result ? sumSeries(result.series) : 0;
  const previousTotal = previousTotals.data ? sumSeries(previousTotals.data.series) : 0;
  const compareTotal = compareResult.data ? sumSeries(compareResult.data.series) : 0;
  // With an explicit compare range active, the KPI delta is current vs. that chosen range instead
  // of the implicit previous period (feat-06 §3 "KPIs show current value + delta vs compare").
  const totalDelta = hasCompareRange
    ? result && compareResult.data
      ? pctDelta(currentTotal, compareTotal)
      : undefined
    : result && previousTotals.data
      ? pctDelta(currentTotal, previousTotal)
      : undefined;
  const totalDeltaLoading = hasCompareRange ? compareResult.isPending : previousTotals.isPending;

  // feat-07: only meaningful for the plain single-series trend below (the compare-range overlay,
  // rendered when `compareRange` is set) — Segment Comparison and Formula mode have their own
  // (multi-series / derived) presentations that anomaly markers aren't wired into.
  const insightsTrendAnomalies = result ? detectAnomalies(seriesTrendRows(result.series)) : [];

  return (
    <PageShell
      projectId={projectId}
      title="Insights"
      description="Pick an event to see its trend. Refine with a date range, grouping, or filters when you need to."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Insights' }]}
      dateRangeControl={
        <>
          <DateRangeControl />
          <CompareControl from={dateFrom} to={dateTo} onChange={setCompareRange} />
        </>
      }
      actions={
        <>
          <CopyLinkButton />
          <AddToDashboardButton
            projectId={projectId}
            draft={{
              kind: 'insights',
              title: events.map((e) => e.name).join(' + ') || 'Insights',
              inlineDefinition: queryDefinition,
            }}
            disabled={!result || compareModeActive || formulaModeActive}
            disabledHint="Run a query first to add it to a dashboard."
          />
          <SaveAsReportButton
            projectId={projectId}
            kind="insights"
            definition={queryDefinition}
            disabled={events.length === 0}
          />
        </>
      }
    >
      {/* "Ask your data" (feat-17 §3.2): the builder header — submitting hydrates + auto-runs the
          normal builder below, so the built query stays transparent and fully editable. */}
      <div className="flex flex-col gap-1.5">
        <AskBar ref={askInputRef} projectId={projectId} onResult={applyDefinition} />
        {askedQuestion && (
          <p className="text-xs text-text-muted">{`Built from: "${askedQuestion}" — edit below.`}</p>
        )}
      </div>

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
                  {!showCompare && (
                    <AddControlButton label="Compare segments" onClick={() => setShowCompare(true)} />
                  )}
                  {!showFormula && <AddControlButton label="Formula" onClick={revealFormula} />}
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

                {showCompare && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Compare segments</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Remove segment comparison"
                        onClick={removeCompare}
                      >
                        Remove
                      </Button>
                    </div>
                    <SegmentCompareControl
                      projectId={projectId}
                      selected={compareSegments}
                      onChange={setCompareSegments}
                    />
                  </div>
                )}

                {showFormula && (
                  <FormulaControl
                    eventOptions={eventOptions}
                    isLoadingEvents={metaEvents.isPending}
                    metricA={formulaA}
                    metricB={formulaB}
                    operator={formulaOp}
                    asPercent={formulaAsPercent}
                    onMetricAChange={setFormulaA}
                    onMetricBChange={setFormulaB}
                    onOperatorChange={setFormulaOp}
                    onAsPercentChange={setFormulaAsPercent}
                    onRemove={removeFormula}
                  />
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

      {!projectHasNoEvents && !compareModeActive && !formulaModeActive && (
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
                hint={compareRange ? `vs ${compareRange.from}–${compareRange.to}` : 'Selected range'}
                delta={totalDelta !== undefined ? { pct: totalDelta } : undefined}
                loading={totalDeltaLoading}
              />
            </SectionGrid>
          )}

          <ChartCard
            title="Trend"
            state={!result ? 'loading' : result.series.length === 0 ? 'empty' : 'ready'}
            emptyText="No data for this query yet."
            exportImageName="insights-trend"
            action={
              <AnnotationsManager
                annotations={annotations}
                onAdd={addAnnotation}
                onRemove={removeAnnotation}
              />
            }
          >
            {result && result.series.length > 0 && compareRange && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-text-muted">
                  {dateFrom}–{dateTo} vs {compareRange.from}–{compareRange.to}
                </p>
                <ComparisonTrend
                  current={seriesTrendRows(result.series)}
                  previous={compareResult.data ? seriesTrendRows(compareResult.data.series) : undefined}
                  xKey="t"
                  valueKey="value"
                  label="Events"
                  ariaLabel="Insights trend vs. compare range"
                  anomalies={insightsTrendAnomalies}
                  annotations={annotations}
                />
                <AnomalyCallout anomalies={insightsTrendAnomalies} />
              </div>
            )}
            {result && result.series.length > 0 && !compareRange && (
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

      {/* Segment Comparison (feat-04 §3.2): the two presentations are mutually exclusive — this
          block only ever renders instead of, never alongside, the single-series result above. */}
      {!projectHasNoEvents && compareModeActive && !formulaModeActive && (
        <div className="flex flex-col gap-6">
          {compareLoading && (
            <p role="status" className="text-sm text-text-muted">
              Comparing {compareSegments.length} segments…
            </p>
          )}

          {!compareLoading && (
            <>
              <ChartCard
                title="Trend"
                state={combinedCompare.series.length === 0 ? 'empty' : 'ready'}
                emptyText="No data for this comparison yet."
                exportImageName="insights-compare-trend"
              >
                <InsightsChart
                  series={combinedCompare.series}
                  eventOrder={compareSegments.map((id) => segmentLabel(id, cohortNameById))}
                  chartType={chartType}
                  onChartTypeChange={setChartTypeFromInput}
                />
              </ChartCard>

              <div>
                <h3 className="mb-2 text-sm font-medium text-text-muted">Segment summary</h3>
                <table className="w-full border-collapse text-left text-sm">
                  <caption className="sr-only">Per-segment totals for the current comparison</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="py-2 font-medium">
                        Segment
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Total
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        vs {combinedCompare.totals[0]?.name ?? 'first segment'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedCompare.totals.map((segmentTotal, index) => (
                      <tr key={`${segmentTotal.name}-${index}`} className="border-b border-border">
                        <td className="py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: colorForIndex(index) }}
                            />
                            {segmentTotal.name}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatExactNumber(segmentTotal.total)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {index === 0
                            ? '—'
                            : `${pctDelta(segmentTotal.total, compareBaselineTotal) >= 0 ? '+' : ''}${pctDelta(segmentTotal.total, compareBaselineTotal)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Formula / Ratio Metrics (feat-05 §3): also mutually exclusive with the normal trend and
          Segment Comparison above — only one of the three result presentations ever renders. */}
      {!projectHasNoEvents && formulaModeActive && (
        <div className="flex flex-col gap-6">
          {formulaResult.isPending && (
            <p role="status" className="text-sm text-text-muted">
              Updating…
            </p>
          )}

          {formulaResult.data && (
            <SectionGrid min={200}>
              <KpiTile
                label="Formula"
                value={formatFormulaValue(formulaComputed.total, formulaAsPercent)}
                hint={`${formulaA.name} ${FORMULA_OPERATOR_SYMBOLS[formulaOp]} ${formulaB.name}`}
                delta={formulaDelta !== undefined ? { pct: formulaDelta } : undefined}
                loading={previousFormulaResult.isPending}
              />
            </SectionGrid>
          )}

          <ChartCard
            title="Trend"
            state={!formulaResult.data ? 'loading' : formulaComputed.data.length === 0 ? 'empty' : 'ready'}
            emptyText="No data for this formula yet."
            exportImageName="insights-formula-trend"
          >
            {formulaResult.data && formulaComputed.data.length > 0 && (
              <FormulaTrendChart
                data={formulaComputed.data}
                asPercent={formulaAsPercent}
                ariaLabel="Formula trend chart"
              />
            )}
          </ChartCard>

          {formulaResult.data && formulaRows.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-muted">Table</h3>
              <FormulaTable
                rows={formulaRows}
                labelA={formulaA.name}
                labelB={formulaB.name}
                asPercent={formulaAsPercent}
              />
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
