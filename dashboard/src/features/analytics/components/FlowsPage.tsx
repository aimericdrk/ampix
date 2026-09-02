import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { fieldLook, Input } from '../../../components/ui/input';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type {
  FlowsDirection,
  FlowsQueryDefinition,
  FlowsResponse,
  FlowsUnit,
  InsightsFilter,
} from '../../../lib/api/types';
import { FLOWS_DIRECTIONS, FLOWS_UNITS, INSIGHTS_FILTER_OPS } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunFlows } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { ChartCard } from './charts/ChartCard';
import { CopyLinkButton } from './CopyLinkButton';
import { KpiTile } from './charts/KpiTile';
import { FlowsChart } from './FlowsChart';
import { PageShell } from '../../../components/layout/PageShell';
import { SaveAsReportButton } from './report-actions';
import { cleanFilters, FilterRows } from './builder-controls';
import { EventSelectField, presetIdForRange } from './explore-controls';
import type { AnalysisStateEnvelope } from '../share-state';
import { useUrlAnalysisState } from '../share-state';

const DIRECTION_LABELS: Record<FlowsDirection, string> = {
  forward: 'Forward (events after anchor)',
  backward: 'Backward (events before anchor)',
};

const UNIT_LABELS: Record<FlowsUnit, string> = {
  session: 'Per session',
  user: 'Per user',
};

/**
 * Flows' shareable-URL shape (feat-01 §3.1/§6 T2) — mirrors the builder state above, plus the
 * `from`/`to` range seed. Every field optional: a link may carry any subset (or none, if
 * malformed) and {@link sanitizeFlowsUrlState} fills in the current defaults per field.
 */
export interface FlowsAnalysisState extends AnalysisStateEnvelope {
  from?: string;
  to?: string;
  anchorEvent?: string;
  anchorFilters?: InsightsFilter[];
  direction?: FlowsDirection;
  steps?: number;
  maxNodesPerStep?: number;
  unit?: FlowsUnit;
}

const DEFAULT_URL_STATE: FlowsAnalysisState = { v: 1 };

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sanitizeAnchorFilters(value: unknown, propertyNames: string[]): InsightsFilter[] {
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

interface SanitizedFlowsState {
  anchorEvent: string;
  anchorFilters: InsightsFilter[];
  direction: FlowsDirection;
  steps: number;
  maxNodesPerStep: number;
  unit: FlowsUnit;
  from?: string;
  to?: string;
}

/**
 * Validates a decoded `s` param field-by-field, dropping anything that doesn't correspond to a
 * real event/property, isn't a recognized enum value, or isn't the right JS type — a bad/stale
 * link never throws, it just silently loses the offending piece. Returns `null` when there isn't
 * even a usable anchor event, since a flow query needs one to mean anything.
 */
function sanitizeFlowsUrlState(
  urlState: FlowsAnalysisState,
  { eventOptions, propertyNames }: { eventOptions: string[]; propertyNames: string[] },
): SanitizedFlowsState | null {
  const raw = urlState as unknown as Record<string, unknown>;

  const anchorEvent =
    typeof raw.anchorEvent === 'string' && eventOptions.includes(raw.anchorEvent)
      ? raw.anchorEvent
      : '';
  if (!anchorEvent) return null;

  const anchorFilters = sanitizeAnchorFilters(raw.anchorFilters, propertyNames);

  const direction =
    typeof raw.direction === 'string' && FLOWS_DIRECTIONS.includes(raw.direction as FlowsDirection)
      ? (raw.direction as FlowsDirection)
      : 'forward';

  const steps =
    typeof raw.steps === 'number' && Number.isFinite(raw.steps) && raw.steps >= 1 && raw.steps <= 5
      ? raw.steps
      : 3;

  const maxNodesPerStep =
    typeof raw.maxNodesPerStep === 'number' &&
    Number.isFinite(raw.maxNodesPerStep) &&
    raw.maxNodesPerStep >= 1 &&
    raw.maxNodesPerStep <= 20
      ? raw.maxNodesPerStep
      : 8;

  const unit =
    typeof raw.unit === 'string' && FLOWS_UNITS.includes(raw.unit as FlowsUnit)
      ? (raw.unit as FlowsUnit)
      : 'session';

  const from = isDateString(raw.from) ? raw.from : undefined;
  const to = isDateString(raw.to) ? raw.to : undefined;

  return { anchorEvent, anchorFilters, direction, steps, maxNodesPerStep, unit, from, to };
}

export function FlowsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/flows' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runFlows = useRunFlows(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Flows shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo, setRange } = useDateRange();
  // Global Filters Bar (feat-02): AND-joins onto the anchor's own filters right before sending.
  const { filters: globalFilters } = useGlobalFilters();

  // Shareable Analysis URLs (feat-01): the `?s=` param is this page's serialized builder state.
  // `urlState` only changes identity when the param itself changes (mount, or back/forward).
  const { urlState, pushState } = useUrlAnalysisState<FlowsAnalysisState>(DEFAULT_URL_STATE);

  const [anchorEvent, setAnchorEvent] = useState('');
  const [anchorFilters, setAnchorFilters] = useState<InsightsFilter[]>([]);
  const [direction, setDirection] = useState<FlowsDirection>('forward');
  const [steps, setSteps] = useState(3);
  const [maxNodesPerStep, setMaxNodesPerStep] = useState(8);
  const [unit, setUnit] = useState<FlowsUnit>('session');
  const [result, setResult] = useState<FlowsResponse | null>(null);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  // Flips true the moment the builder reflects something worth sharing — either a real user edit,
  // or the state we just hydrated from a link — so `pushState` only ever fires once there's a
  // meaningful view to write back (never on the bare "no param yet" initial render, per §4).
  const userInteractedRef = useRef(false);

  const setAnchorEventFromInput = (next: string) => {
    userInteractedRef.current = true;
    setAnchorEvent(next);
  };

  const setAnchorFiltersFromInput = (next: InsightsFilter[]) => {
    userInteractedRef.current = true;
    setAnchorFilters(next);
  };

  const setDirectionFromInput = (next: FlowsDirection) => {
    userInteractedRef.current = true;
    setDirection(next);
  };

  const setStepsFromInput = (next: number) => {
    userInteractedRef.current = true;
    setSteps(next);
  };

  const setMaxNodesPerStepFromInput = (next: number) => {
    userInteractedRef.current = true;
    setMaxNodesPerStep(next);
  };

  const setUnitFromInput = (next: FlowsUnit) => {
    userInteractedRef.current = true;
    setUnit(next);
  };

  // On first load: hydrate from a shared `s` link (validating field-by-field, dropping anything
  // that doesn't correspond to a real event/property — see `sanitizeFlowsUrlState`) once both
  // metadata queries are in, so event/property names can actually be checked. Falls back to the
  // normal empty builder when there's no usable `s` state. Only ever runs once, so clearing the
  // builder afterwards stays cleared.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !metaEvents.isSuccess || !metaProperties.isSuccess) return;
    didInit.current = true;

    const hydrated = sanitizeFlowsUrlState(urlState, { eventOptions, propertyNames });
    if (!hydrated) return;

    setAnchorEvent(hydrated.anchorEvent);
    setAnchorFilters(hydrated.anchorFilters);
    setDirection(hydrated.direction);
    setSteps(hydrated.steps);
    setMaxNodesPerStep(hydrated.maxNodesPerStep);
    setUnit(hydrated.unit);
    if (hydrated.from && hydrated.to) {
      setRange(hydrated.from, hydrated.to, presetIdForRange(hydrated.from, hydrated.to));
    }
    // Self-healing (§4): the next edit rewrites a clean `s` reflecting the sanitized state.
    userInteractedRef.current = true;

    // Opening a shared link reproduces AND runs the exact view (feat-01 §2) — built directly from
    // the sanitized fields (not the not-yet-committed state) so this first run is exact.
    const def: FlowsQueryDefinition = {
      anchor: {
        event: hydrated.anchorEvent,
        filters: mergeGlobalFilters(hydrated.anchorFilters, globalFilters),
      },
      direction: hydrated.direction,
      date_range: { from: hydrated.from ?? dateFrom, to: hydrated.to ?? dateTo },
      steps: hydrated.steps,
      max_nodes_per_step: hydrated.maxNodesPerStep,
      unit: hydrated.unit,
    };
    runFlows.mutate(def, { onSuccess: setResult });
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
    runFlows,
  ]);

  const queryDefinition: FlowsQueryDefinition = useMemo(
    () => ({
      anchor: { event: anchorEvent, filters: mergeGlobalFilters(anchorFilters, globalFilters) },
      direction,
      date_range: { from: dateFrom, to: dateTo },
      steps,
      max_nodes_per_step: maxNodesPerStep,
      unit,
    }),
    [anchorEvent, anchorFilters, globalFilters, direction, dateFrom, dateTo, steps, maxNodesPerStep, unit],
  );

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
    const next: FlowsAnalysisState = {
      v: 1,
      from: dateFrom,
      to: dateTo,
      anchorEvent,
      anchorFilters: cleanFilters(anchorFilters),
      direction,
      steps,
      maxNodesPerStep,
      unit,
    };
    pushState(next);
  }, [anchorEvent, anchorFilters, direction, steps, maxNodesPerStep, unit, dateFrom, dateTo, pushState]);

  const canRun =
    Boolean(anchorEvent.trim()) && Boolean(dateFrom) && Boolean(dateTo) && !runFlows.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runFlows.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <PageShell
      projectId={projectId}
      title="Flows"
      description="Explore the common paths users take before or after a key event. Built from device events only — a backend write is not a step the user took."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Flows' }]}
      dateRangeControl={<DateRangeControl />}
      actions={<CopyLinkButton />}
    >
      <Card>
        <CardHeader>
          <CardTitle>Flow builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <EventSelectField
              label="Anchor event"
              value={anchorEvent}
              onChange={setAnchorEventFromInput}
              options={eventOptions}
              isLoading={metaEvents.isPending}
              placeholder="Select event…"
            />
            <FilterRows
              idPrefix="flows-anchor-filter"
              ariaLabel="Anchor filter"
              filters={anchorFilters}
              onChange={setAnchorFiltersFromInput}
              propertyNames={propertyNames}
              projectId={projectId}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="flows-direction" className="mb-1 block text-sm font-medium">
                Direction
              </label>
              <select
                id="flows-direction"
                value={direction}
                onChange={(e) => setDirectionFromInput(e.target.value as FlowsDirection)}
                className={cn(fieldLook, 'w-auto')}
              >
                {FLOWS_DIRECTIONS.map((value) => (
                  <option key={value} value={value}>
                    {DIRECTION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="flows-unit" className="mb-1 block text-sm font-medium">
                Unit
              </label>
              <select
                id="flows-unit"
                value={unit}
                onChange={(e) => setUnitFromInput(e.target.value as FlowsUnit)}
                className={cn(fieldLook, 'w-auto')}
              >
                {FLOWS_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {UNIT_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="flows-steps" className="mb-1 block text-sm font-medium">
                Steps (hops)
              </label>
              <Input
                id="flows-steps"
                type="number"
                min={1}
                max={5}
                value={steps}
                onChange={(e) => setStepsFromInput(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <div>
              <label htmlFor="flows-max-nodes" className="mb-1 block text-sm font-medium">
                Max nodes per step
              </label>
              <Input
                id="flows-max-nodes"
                type="number"
                min={1}
                max={20}
                value={maxNodesPerStep}
                onChange={(e) => setMaxNodesPerStepFromInput(Number(e.target.value))}
                className="w-32"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={!canRun}>
              {runFlows.isPending ? 'Running…' : 'Run'}
            </Button>
            <SaveAsReportButton
              projectId={projectId}
              kind="flows"
              definition={queryDefinition}
              disabled={!anchorEvent.trim()}
            />
          </div>
        </CardContent>
      </Card>

      {runFlows.isError && (
        <p role="alert" className="text-danger">
          {runFlows.error instanceof ApiError
            ? runFlows.error.problem.title
            : 'Failed to run the flow'}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          {result.nodes.length > 0 && (
            <SectionGrid min={220}>
              <KpiTile
                label={unit === 'user' ? 'Total users' : 'Total sessions'}
                value={result.nodes
                  .filter((node) => node.step === 0)
                  .reduce((sum, node) => sum + node.value, 0)}
              />
            </SectionGrid>
          )}

          <ChartCard
            title="Flow"
            state={result.nodes.length === 0 ? 'empty' : 'ready'}
            emptyText="No flow data for this query yet."
          >
            {result.nodes.length > 0 && (
              <FlowsChart nodes={result.nodes} links={result.links} />
            )}
          </ChartCard>
        </div>
      )}
    </PageShell>
  );
}
