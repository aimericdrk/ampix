import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
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
import { formatExactNumber } from '../format';
import { DateRangeFields, defaultDate } from './builder-controls';
import { MermaidDiagram } from './charts/MermaidDiagram';
import { PathMap } from './PathMap';
import { buildScreenPathsMermaid, screenLabel } from './path-layout';

const DIRECTION_LABELS: Record<FlowsDirection, string> = {
  forward: 'Forward (screens after anchor)',
  backward: 'Backward (screens before anchor)',
};

const UNIT_LABELS: Record<FlowsUnit, string> = {
  session: 'Per session',
  user: 'Per user',
};

type PathView = 'map' | 'diagram';

export function PathsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/paths' });
  const screens = useScreens(projectId);
  const runScreenPaths = useRunScreenPaths(projectId);

  const [anchorScreen, setAnchorScreen] = useState('');
  const [direction, setDirection] = useState<FlowsDirection>('forward');
  const [dateFrom, setDateFrom] = useState(() => defaultDate(30));
  const [dateTo, setDateTo] = useState(() => defaultDate(0));
  const [steps, setSteps] = useState(3);
  const [maxNodesPerStep, setMaxNodesPerStep] = useState(6);
  const [unit, setUnit] = useState<FlowsUnit>('session');
  const [view, setView] = useState<PathView>('map');
  const [result, setResult] = useState<ScreenPathsResponse | null>(null);

  const screenOptions = screens.data?.screens.map((s) => s.screen_name) ?? [];

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

  return (
    <PageShell
      projectId={projectId}
      title="Paths"
      description="See how users move between app screens — an interactive map of real screenshots, or the same paths as a flowchart."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Paths' }]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Path builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <label htmlFor="paths-anchor" className="mb-1 block text-sm font-medium">
              Anchor screen (optional)
            </label>
            <Input
              id="paths-anchor"
              list="paths-anchor-options"
              placeholder="Leave blank to start from top entry screens"
              value={anchorScreen}
              onChange={(e) => setAnchorScreen(e.target.value)}
            />
            <datalist id="paths-anchor-options">
              {screenOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <DateRangeFields
            idPrefix="paths-date"
            from={dateFrom}
            to={dateTo}
            onFrom={setDateFrom}
            onTo={setDateTo}
          />

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="paths-direction" className="mb-1 block text-sm font-medium">
                Direction
              </label>
              <select
                id="paths-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as FlowsDirection)}
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
                onChange={(e) => setUnit(e.target.value as FlowsUnit)}
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
                onChange={(e) => setSteps(Number(e.target.value))}
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
                onChange={(e) => setMaxNodesPerStep(Number(e.target.value))}
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
          <div
            role="group"
            aria-label="Path view"
            className="inline-flex w-fit rounded-md border border-border p-0.5"
          >
            <ViewToggle current={view} value="map" label="Map" onSelect={setView} />
            <ViewToggle current={view} value="diagram" label="Diagram" onSelect={setView} />
          </div>

          {view === 'map' ? (
            <PathMap projectId={projectId} nodes={result.nodes} links={result.links} />
          ) : (
            <MermaidDiagram chart={mermaidChart} ariaLabel="User path flowchart" />
          )}

          <TransitionsTable result={result} />
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
