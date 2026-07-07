import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { PageShell } from '../../../components/layout/PageShell';
import { ApiError } from '../../../lib/api/problem';
import type {
  FlowsDirection,
  FlowsUnit,
  ScreenPathsQuery,
  ScreenPathsResponse,
} from '../../../lib/api/types';
import { FLOWS_DIRECTIONS, FLOWS_UNITS } from '../../../lib/api/types';
import { useRunScreenPaths, useScreens } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { formatExactNumber } from '../format';
import { EventSelectField, presetIdForRange } from './explore-controls';
import { ChartCard } from './charts/ChartCard';
import { CopyLinkButton } from './CopyLinkButton';
import { KpiTile } from './charts/KpiTile';
import { MermaidDiagram } from './charts/MermaidDiagram';
import { PathMap } from './PathMap';
import { buildScreenPathsMermaid, screenLabel } from './path-layout';
import type { AnalysisStateEnvelope } from '../share-state';
import { useUrlAnalysisState } from '../share-state';

const DIRECTION_LABELS: Record<FlowsDirection, string> = {
  forward: 'Forward (screens after anchor)',
  backward: 'Backward (screens before anchor)',
};

const UNIT_LABELS: Record<FlowsUnit, string> = {
  session: 'Per session',
  user: 'Per user',
};

type PathView = 'map' | 'diagram';

/**
 * Paths' shareable-URL shape (feat-01 §3.1/§6 T2) — mirrors the builder state above, plus the
 * `from`/`to` range seed. Unlike the other builder pages, a blank `anchorScreen` is a legitimate,
 * meaningful choice ("start from the top entry screens"), so every field here — including the
 * anchor — is genuinely optional; see {@link sanitizePathsUrlState}.
 */
export interface PathsAnalysisState extends AnalysisStateEnvelope {
  from?: string;
  to?: string;
  anchorScreen?: string;
  direction?: FlowsDirection;
  steps?: number;
  maxNodesPerStep?: number;
  unit?: FlowsUnit;
}

const DEFAULT_URL_STATE: PathsAnalysisState = { v: 1 };

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface SanitizedPathsState {
  anchorScreen: string;
  direction: FlowsDirection;
  steps: number;
  maxNodesPerStep: number;
  unit: FlowsUnit;
  from?: string;
  to?: string;
}

/**
 * Validates a decoded `s` param field-by-field, dropping anything that doesn't correspond to a
 * real screen, isn't a recognized enum value, or isn't the right JS type — a bad/stale link never
 * throws, it just silently loses the offending piece and falls back to that field's default.
 * Unlike the other builder pages this never returns `null`: every field (including the anchor
 * screen) is optional, so there is always a sensible view to hydrate/run.
 */
function sanitizePathsUrlState(
  urlState: PathsAnalysisState,
  { screenOptions }: { screenOptions: string[] },
): SanitizedPathsState {
  const raw = urlState as unknown as Record<string, unknown>;

  const anchorScreen =
    typeof raw.anchorScreen === 'string' && screenOptions.includes(raw.anchorScreen)
      ? raw.anchorScreen
      : '';

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
      : 6;

  const unit =
    typeof raw.unit === 'string' && FLOWS_UNITS.includes(raw.unit as FlowsUnit)
      ? (raw.unit as FlowsUnit)
      : 'session';

  const from = isDateString(raw.from) ? raw.from : undefined;
  const to = isDateString(raw.to) ? raw.to : undefined;

  return { anchorScreen, direction, steps, maxNodesPerStep, unit, from, to };
}

export function PathsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/paths' });
  const screens = useScreens(projectId);
  const runScreenPaths = useRunScreenPaths(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Paths shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo, setRange } = useDateRange();

  // Shareable Analysis URLs (feat-01): the `?s=` param is this page's serialized builder state.
  // `urlState` only changes identity when the param itself changes (mount, or back/forward); it
  // stays the exact `DEFAULT_URL_STATE` reference when there's no (or a malformed) `s` param, which
  // is how the hydration effect below tells "a real shared link" apart from "nothing to hydrate".
  const { urlState, pushState } = useUrlAnalysisState<PathsAnalysisState>(DEFAULT_URL_STATE);

  const [anchorScreen, setAnchorScreen] = useState('');
  const [direction, setDirection] = useState<FlowsDirection>('forward');
  const [steps, setSteps] = useState(3);
  const [maxNodesPerStep, setMaxNodesPerStep] = useState(6);
  const [unit, setUnit] = useState<FlowsUnit>('session');
  const [view, setView] = useState<PathView>('map');
  const [result, setResult] = useState<ScreenPathsResponse | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);
  const closeFullscreenRef = useRef<HTMLButtonElement>(null);

  const screenOptions = screens.data?.screens.map((s) => s.screen_name) ?? [];
  // screen_name → latest image_hash, so each map node's screenshot is content-addressed (retake-safe).
  const screenHashes = useMemo(
    () => new Map(screens.data?.screens.map((s) => [s.screen_name, s.latest_image_hash]) ?? []),
    [screens.data],
  );

  // Flips true the moment the builder reflects something worth sharing — either a real user edit,
  // or the state we just hydrated from a link — so `pushState` only ever fires once there's a
  // meaningful view to write back (never on the bare "no param yet" initial render, per §4).
  const userInteractedRef = useRef(false);

  const setAnchorScreenFromInput = (next: string) => {
    userInteractedRef.current = true;
    setAnchorScreen(next);
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
  // that doesn't correspond to a real screen — see `sanitizePathsUrlState`) once the screens
  // catalog is in, so the anchor can actually be checked. Only runs when a real link was present
  // (`urlState` no longer the default reference) — a bare page load keeps the normal empty builder.
  // Only ever runs once, so clearing the builder afterwards stays cleared.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !screens.isSuccess) return;
    didInit.current = true;
    if (urlState === DEFAULT_URL_STATE) return;

    const hydrated = sanitizePathsUrlState(urlState, { screenOptions });
    setAnchorScreen(hydrated.anchorScreen);
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
    const hydratedQuery: ScreenPathsQuery = {
      ...(hydrated.anchorScreen ? { anchor_screen: hydrated.anchorScreen } : {}),
      direction: hydrated.direction,
      date_range: { from: hydrated.from ?? dateFrom, to: hydrated.to ?? dateTo },
      steps: hydrated.steps,
      max_nodes_per_step: hydrated.maxNodesPerStep,
      unit: hydrated.unit,
    };
    runScreenPaths.mutate(hydratedQuery, { onSuccess: setResult });
  }, [screens.isSuccess, urlState, screenOptions, dateFrom, dateTo, setRange, runScreenPaths]);

  const query: ScreenPathsQuery = useMemo(() => {
    const trimmed = anchorScreen.trim();
    return {
      // Omit anchor_screen entirely when blank → the backend starts from the top entry screens.
      ...(trimmed ? { anchor_screen: trimmed } : {}),
      direction,
      date_range: { from: dateFrom, to: dateTo },
      steps,
      max_nodes_per_step: maxNodesPerStep,
      unit,
    };
  }, [anchorScreen, direction, dateFrom, dateTo, steps, maxNodesPerStep, unit]);

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
    const next: PathsAnalysisState = {
      v: 1,
      from: dateFrom,
      to: dateTo,
      anchorScreen: anchorScreen || undefined,
      direction,
      steps,
      maxNodesPerStep,
      unit,
    };
    pushState(next);
  }, [anchorScreen, direction, steps, maxNodesPerStep, unit, dateFrom, dateTo, pushState]);

  const canRun = Boolean(dateFrom) && Boolean(dateTo) && !runScreenPaths.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runScreenPaths.mutate(query, { onSuccess: setResult });
  };

  const hasResult = result !== null && result.nodes.length > 0;
  const mermaidChart = useMemo(
    () => (result ? buildScreenPathsMermaid(result.nodes, result.links) : ''),
    [result],
  );

  const closeFullscreen = () => setIsFullscreen(false);

  // While the fullscreen map is open: focus into the dialog, close on Esc, restore focus on close,
  // and lock body scroll — all torn down together when the overlay unmounts.
  useEffect(() => {
    if (!isFullscreen) return;
    const trigger = fullscreenTriggerRef.current;
    closeFullscreenRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isFullscreen]);

  return (
    <PageShell
      projectId={projectId}
      title="Paths"
      description="See how users move between app screens — an interactive map of real screenshots, or the same paths as a flowchart."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Paths' }]}
      dateRangeControl={<DateRangeControl />}
      actions={<CopyLinkButton />}
    >
      <Card>
        <CardHeader>
          <CardTitle>Path builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <EventSelectField
            label="Anchor screen"
            value={anchorScreen}
            onChange={setAnchorScreenFromInput}
            options={screenOptions}
            isLoading={screens.isPending}
            noun="screen"
            placeholder="Any entry screen"
            emptyLabel="No screens captured yet."
            allowClear
          />

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="paths-direction" className="mb-1 block text-sm font-medium">
                Direction
              </label>
              <select
                id="paths-direction"
                value={direction}
                onChange={(e) => setDirectionFromInput(e.target.value as FlowsDirection)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {FLOWS_DIRECTIONS.map((value) => (
                  <option key={value} value={value}>
                    {DIRECTION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="paths-unit" className="mb-1 block text-sm font-medium">
                Unit
              </label>
              <select
                id="paths-unit"
                value={unit}
                onChange={(e) => setUnitFromInput(e.target.value as FlowsUnit)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {FLOWS_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {UNIT_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="paths-steps" className="mb-1 block text-sm font-medium">
                Steps (hops)
              </label>
              <input
                id="paths-steps"
                type="number"
                min={1}
                max={5}
                value={steps}
                onChange={(e) => setStepsFromInput(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="paths-max-nodes" className="mb-1 block text-sm font-medium">
                Max screens per step
              </label>
              <input
                id="paths-max-nodes"
                type="number"
                min={1}
                max={20}
                value={maxNodesPerStep}
                onChange={(e) => setMaxNodesPerStepFromInput(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <Button onClick={handleRun} disabled={!canRun}>
              {runScreenPaths.isPending ? 'Running…' : 'Run'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {runScreenPaths.isError && (
        <p role="alert" className="text-danger">
          {runScreenPaths.error instanceof ApiError
            ? runScreenPaths.error.problem.title
            : 'Failed to run the path query'}
        </p>
      )}

      {result && result.nodes.length === 0 && (
        <p className="text-text-muted">No screen-path data for this query yet.</p>
      )}

      {hasResult && result && (
        <div className="flex flex-col gap-4">
          <SectionGrid min={220}>
            <KpiTile
              label={unit === 'user' ? 'Total users' : 'Total sessions'}
              value={result.nodes
                .filter((node) => node.step === 0)
                .reduce((sum, node) => sum + node.value, 0)}
            />
          </SectionGrid>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Path view"
              className="inline-flex w-fit rounded-md border border-border p-0.5"
            >
              <ViewToggle current={view} value="map" label="Map" onSelect={setView} />
              <ViewToggle current={view} value="diagram" label="Diagram" onSelect={setView} />
            </div>
            {view === 'map' && (
              <Button
                ref={fullscreenTriggerRef}
                variant="secondary"
                size="sm"
                onClick={() => setIsFullscreen(true)}
              >
                Fullscreen
              </Button>
            )}
          </div>

          <ChartCard title="Screen paths">
            {view === 'map' ? (
              <PathMap
                projectId={projectId}
                nodes={result.nodes}
                links={result.links}
                screenHashes={screenHashes}
              />
            ) : (
              <MermaidDiagram chart={mermaidChart} ariaLabel="User path flowchart" />
            )}
          </ChartCard>

          <TransitionsTable result={result} />

          {isFullscreen && view === 'map' && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="User path map (fullscreen)"
              className="fixed inset-0 z-50 flex flex-col gap-3 bg-surface p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">User path map</h2>
                <Button
                  ref={closeFullscreenRef}
                  variant="secondary"
                  size="sm"
                  onClick={closeFullscreen}
                  aria-label="Exit fullscreen"
                >
                  Close
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <PathMap
                  projectId={projectId}
                  nodes={result.nodes}
                  links={result.links}
                  screenHashes={screenHashes}
                  fullHeight
                />
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function ViewToggle({
  current,
  value,
  label,
  onSelect,
}: {
  current: PathView;
  value: PathView;
  label: string;
  onSelect: (view: PathView) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={
        active
          ? 'rounded px-3 py-1.5 text-sm font-medium bg-border/60 text-text'
          : 'rounded px-3 py-1.5 text-sm text-text-muted hover:text-text'
      }
    >
      {label}
    </button>
  );
}

/** The always-present accessible view of the same data (screens + transitions with exact counts). */
function TransitionsTable({ result }: { result: ScreenPathsResponse }) {
  const labelById = new Map(result.nodes.map((n) => [n.id, screenLabel(n.event)]));
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-text-muted">Transitions</h3>
      <table className="w-full max-w-xl border-collapse text-left text-sm">
        <caption className="sr-only">Screen-path transitions</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 font-medium">
              From
            </th>
            <th scope="col" className="py-2 font-medium">
              To
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Users
            </th>
          </tr>
        </thead>
        <tbody>
          {result.links.map((link, index) => (
            <tr key={`${link.source}-${link.target}-${index}`} className="border-b border-border">
              <td className="py-2">{labelById.get(link.source) ?? link.source}</td>
              <td className="py-2">{labelById.get(link.target) ?? link.target}</td>
              <td className="py-2 text-right tabular-nums">{formatExactNumber(link.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
