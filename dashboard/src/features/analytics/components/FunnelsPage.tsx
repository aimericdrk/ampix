import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { ApiError } from '../../../lib/api/problem';
import type {
  FunnelOrder,
  FunnelQueryDefinition,
  FunnelResponse,
  FunnelStep,
  InsightsFilter,
} from '../../../lib/api/types';
import { FUNNEL_ORDERS, INSIGHTS_FILTER_OPS } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunFunnels } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { formatExactNumber, formatPercent } from '../format';
import { ChartCard } from './charts/ChartCard';
import { CopyLinkButton } from './CopyLinkButton';
import { KpiTile } from './charts/KpiTile';
import { FunnelChart } from './FunnelChart';
import { PageShell } from '../../../components/layout/PageShell';
import { SaveAsReportButton } from './report-actions';
import { SegmentPicker } from './SegmentPicker';
import { cleanFilters, FilterRows } from './builder-controls';
import { EventPicker, presetIdForRange } from './explore-controls';
import type { AnalysisStateEnvelope } from '../share-state';
import { useUrlAnalysisState } from '../share-state';

const MAX_STEPS = 8;

interface StepDraft {
  event: string;
  filters: InsightsFilter[];
}

const ORDER_LABELS: Record<FunnelOrder, string> = {
  any: 'Any order',
  strict_order: 'Strict order',
};

/**
 * Funnels' shareable-URL shape (feat-01 §3.1/§6 T2) — mirrors the builder state above, plus the
 * `from`/`to` range seed. Every field optional: a link may carry any subset (or none, if
 * malformed) and {@link sanitizeFunnelsUrlState} fills in the current defaults per field.
 */
export interface FunnelsAnalysisState extends AnalysisStateEnvelope {
  from?: string;
  to?: string;
  segmentId?: string | null;
  steps?: { event: string; filters: InsightsFilter[] }[];
  windowDays?: number;
  order?: FunnelOrder;
  breakdownProperty?: string;
}

const DEFAULT_URL_STATE: FunnelsAnalysisState = { v: 1 };

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface SanitizedFunnelsState {
  steps: StepDraft[];
  windowDays: number;
  order: FunnelOrder;
  breakdownProperty: string;
  segmentId: string | null;
  from?: string;
  to?: string;
}

/**
 * Validates a decoded `s` param field-by-field, dropping anything that doesn't correspond to a
 * real event/property, isn't a recognized enum value, or isn't the right JS type — a bad/stale
 * link never throws, it just silently loses the offending piece. Returns `null` when there aren't
 * at least two usable steps, since a funnel needs that minimum to mean anything.
 */
function sanitizeFunnelsUrlState(
  urlState: FunnelsAnalysisState,
  { eventOptions, propertyNames }: { eventOptions: string[]; propertyNames: string[] },
): SanitizedFunnelsState | null {
  const raw = urlState as unknown as Record<string, unknown>;

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: StepDraft[] = [];
  for (const candidate of rawSteps) {
    if (steps.length >= MAX_STEPS) break;
    if (!candidate || typeof candidate !== 'object') continue;
    const { event, filters } = candidate as Record<string, unknown>;
    if (typeof event !== 'string' || !eventOptions.includes(event)) continue;
    const cleanedFilters: InsightsFilter[] = [];
    if (Array.isArray(filters)) {
      for (const f of filters) {
        if (!f || typeof f !== 'object') continue;
        const { property, op, value } = f as Record<string, unknown>;
        if (typeof property !== 'string' || !propertyNames.includes(property)) continue;
        if (typeof op !== 'string' || !INSIGHTS_FILTER_OPS.includes(op as InsightsFilter['op']))
          continue;
        if (value !== undefined && typeof value !== 'string') continue;
        cleanedFilters.push({ property, op: op as InsightsFilter['op'], value: value as string | undefined });
      }
    }
    steps.push({ event, filters: cleanedFilters });
  }
  if (steps.length < 2) return null;

  const windowDays =
    typeof raw.windowDays === 'number' && Number.isFinite(raw.windowDays) && raw.windowDays >= 1 && raw.windowDays <= 365
      ? raw.windowDays
      : 7;

  const order =
    typeof raw.order === 'string' && FUNNEL_ORDERS.includes(raw.order as FunnelOrder)
      ? (raw.order as FunnelOrder)
      : 'any';

  const breakdownProperty =
    typeof raw.breakdownProperty === 'string' && propertyNames.includes(raw.breakdownProperty)
      ? raw.breakdownProperty
      : '';

  // A stale/deleted segment id can't be told apart from "not loaded yet" here (SegmentPicker owns
  // the live cohort list) — only the shape is validated; an unknown id simply shows unselected.
  const segmentId = typeof raw.segmentId === 'string' ? raw.segmentId : null;

  const from = isDateString(raw.from) ? raw.from : undefined;
  const to = isDateString(raw.to) ? raw.to : undefined;

  return { steps, windowDays, order, breakdownProperty, segmentId, from, to };
}

export function FunnelsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/funnels' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runFunnels = useRunFunnels(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Funnels shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo, setRange } = useDateRange();

  // Shareable Analysis URLs (feat-01): the `?s=` param is this page's serialized builder state.
  // `urlState` only changes identity when the param itself changes (mount, or back/forward).
  const { urlState, pushState } = useUrlAnalysisState<FunnelsAnalysisState>(DEFAULT_URL_STATE);

  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [windowDays, setWindowDays] = useState(7);
  const [order, setOrder] = useState<FunnelOrder>('any');
  const [breakdownProperty, setBreakdownProperty] = useState('');
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [result, setResult] = useState<FunnelResponse | null>(null);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  // Flips true the moment the builder reflects something worth sharing — either a real user edit,
  // or the state we just hydrated from a link — so `pushState` only ever fires once there's a
  // meaningful view to write back (never on the bare "no param yet" initial render, per §4).
  const userInteractedRef = useRef(false);

  const addStep = (name: string) => {
    if (!name || steps.length >= MAX_STEPS) return;
    userInteractedRef.current = true;
    setSteps((current) => [...current, { event: name, filters: [] }]);
  };

  const removeStep = (index: number) => {
    userInteractedRef.current = true;
    setSteps((current) => current.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, delta: number) => {
    userInteractedRef.current = true;
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return current;
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
  };

  const setStepFilters = (index: number, filters: InsightsFilter[]) => {
    userInteractedRef.current = true;
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, filters } : s)));
  };

  const setWindowDaysFromInput = (next: number) => {
    userInteractedRef.current = true;
    setWindowDays(next);
  };

  const setOrderFromInput = (next: FunnelOrder) => {
    userInteractedRef.current = true;
    setOrder(next);
  };

  const setBreakdownPropertyFromInput = (next: string) => {
    userInteractedRef.current = true;
    setBreakdownProperty(next);
  };

  const setSegmentIdFromInput = (next: string | null) => {
    userInteractedRef.current = true;
    setSegmentId(next);
  };

  // On first load: hydrate from a shared `s` link (validating field-by-field, dropping anything
  // that doesn't correspond to a real event/property — see `sanitizeFunnelsUrlState`) once both
  // metadata queries are in, so event/property names can actually be checked. Falls back to the
  // normal empty builder when there's no usable `s` state. Only ever runs once, so clearing the
  // builder afterwards stays cleared.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !metaEvents.isSuccess || !metaProperties.isSuccess) return;
    didInit.current = true;

    const hydrated = sanitizeFunnelsUrlState(urlState, { eventOptions, propertyNames });
    if (!hydrated) return;

    setSteps(hydrated.steps);
    setWindowDays(hydrated.windowDays);
    setOrder(hydrated.order);
    if (hydrated.breakdownProperty) setBreakdownProperty(hydrated.breakdownProperty);
    if (hydrated.segmentId) setSegmentId(hydrated.segmentId);
    if (hydrated.from && hydrated.to) {
      setRange(hydrated.from, hydrated.to, presetIdForRange(hydrated.from, hydrated.to));
    }
    // Self-healing (§4): the next edit rewrites a clean `s` reflecting the sanitized state.
    userInteractedRef.current = true;

    // Opening a shared link reproduces AND runs the exact view (feat-01 §2) — built directly from
    // the sanitized fields (not the not-yet-committed state) so this first run is exact.
    const cleanedSteps: FunnelStep[] = hydrated.steps.map((s) => ({
      event: s.event,
      filters: cleanFilters(s.filters),
    }));
    const def: FunnelQueryDefinition = {
      steps: cleanedSteps,
      date_range: { from: hydrated.from ?? dateFrom, to: hydrated.to ?? dateTo },
      window_days: hydrated.windowDays,
      order: hydrated.order,
    };
    if (hydrated.breakdownProperty) def.breakdown = { property: hydrated.breakdownProperty };
    if (hydrated.segmentId) def.cohort_id = hydrated.segmentId;
    runFunnels.mutate(def, { onSuccess: setResult });
  }, [
    metaEvents.isSuccess,
    metaProperties.isSuccess,
    urlState,
    eventOptions,
    propertyNames,
    dateFrom,
    dateTo,
    setRange,
    runFunnels,
  ]);

  const queryDefinition: FunnelQueryDefinition = useMemo(() => {
    const cleanedSteps: FunnelStep[] = steps.map((s) => ({
      event: s.event,
      filters: cleanFilters(s.filters),
    }));
    const def: FunnelQueryDefinition = {
      steps: cleanedSteps,
      date_range: { from: dateFrom, to: dateTo },
      window_days: windowDays,
      order,
    };
    if (breakdownProperty) def.breakdown = { property: breakdownProperty };
    if (segmentId) def.cohort_id = segmentId;
    return def;
  }, [steps, dateFrom, dateTo, windowDays, order, breakdownProperty, segmentId]);

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
    const next: FunnelsAnalysisState = {
      v: 1,
      from: dateFrom,
      to: dateTo,
      segmentId,
      steps: steps.map((s) => ({ event: s.event, filters: cleanFilters(s.filters) })),
      windowDays,
      order,
      breakdownProperty: breakdownProperty || undefined,
    };
    pushState(next);
  }, [steps, windowDays, order, breakdownProperty, segmentId, dateFrom, dateTo, pushState]);

  const canRun =
    steps.length >= 2 && Boolean(dateFrom) && Boolean(dateTo) && !runFunnels.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runFunnels.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <PageShell
      projectId={projectId}
      title="Funnels"
      description="See how users move through an ordered sequence of steps, and where they drop off."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Funnels' }]}
      dateRangeControl={<DateRangeControl />}
      actions={<CopyLinkButton />}
    >
      <Card>
        <CardHeader>
          <CardTitle>Funnel builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <span className="mb-1 block text-sm font-medium">Steps (2–{MAX_STEPS}, in order)</span>

            {steps.length > 0 && (
              <ul className="mt-3 flex flex-col gap-3">
                {steps.map((step, index) => (
                  <li
                    key={`${step.event}-${index}`}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium">
                        {index + 1}. {step.event}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Move step ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        Up
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Move step ${index + 1} down`}
                        disabled={index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        Down
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove step ${index + 1}`}
                        onClick={() => removeStep(index)}
                      >
                        Remove
                      </Button>
                    </div>
                    <FilterRows
                      idPrefix={`funnel-step-${index}-filter`}
                      ariaLabel={`Step ${index + 1} filter`}
                      filters={step.filters}
                      onChange={(filters) => setStepFilters(index, filters)}
                      propertyNames={propertyNames}
                      projectId={projectId}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <EventPicker
                options={eventOptions}
                onSelect={addStep}
                isLoading={metaEvents.isPending}
                disabled={steps.length >= MAX_STEPS}
                comboLabel="Add step"
                triggerLabel="Add step"
              />
            </div>
            {steps.length < 2 && (
              <p className="mt-2 text-xs text-text-muted">Add at least two steps to run a funnel.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="funnel-window" className="mb-1 block text-sm font-medium">
                Conversion window (days)
              </label>
              <input
                id="funnel-window"
                type="number"
                min={1}
                max={365}
                value={windowDays}
                onChange={(e) => setWindowDaysFromInput(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="funnel-order" className="mb-1 block text-sm font-medium">
                Step order
              </label>
              <select
                id="funnel-order"
                value={order}
                onChange={(e) => setOrderFromInput(e.target.value as FunnelOrder)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {FUNNEL_ORDERS.map((value) => (
                  <option key={value} value={value}>
                    {ORDER_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="funnel-breakdown" className="mb-1 block text-sm font-medium">
                Breakdown (optional)
              </label>
              <select
                id="funnel-breakdown"
                value={breakdownProperty}
                onChange={(e) => setBreakdownPropertyFromInput(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                <option value="">No breakdown</option>
                {propertyNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SegmentPicker projectId={projectId} value={segmentId} onChange={setSegmentIdFromInput} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={!canRun}>
              {runFunnels.isPending ? 'Running…' : 'Run'}
            </Button>
            <SaveAsReportButton
              projectId={projectId}
              kind="funnel"
              definition={queryDefinition}
              disabled={steps.length < 2}
            />
          </div>
        </CardContent>
      </Card>

      {runFunnels.isError && (
        <p role="alert" className="text-danger">
          {runFunnels.error instanceof ApiError
            ? runFunnels.error.problem.title
            : 'Failed to run the funnel'}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          {result.steps.length > 0 && (
            <SectionGrid min={200}>
              <KpiTile
                label="Overall conversion"
                value={formatPercent(result.overall_conversion)}
              />
              <KpiTile label="Entered" value={formatExactNumber(result.steps[0]?.count ?? 0)} />
              <KpiTile
                label="Converted"
                value={formatExactNumber(result.steps[result.steps.length - 1]?.count ?? 0)}
              />
            </SectionGrid>
          )}

          <ChartCard
            title="Funnel"
            state={result.steps.length === 0 ? 'empty' : 'ready'}
            emptyText="No data for this funnel yet."
          >
            {result.steps.length > 0 && (
              <FunnelChart
                steps={result.steps}
                overallConversion={result.overall_conversion}
                breakdowns={result.breakdowns}
              />
            )}
          </ChartCard>
        </div>
      )}
    </PageShell>
  );
}
