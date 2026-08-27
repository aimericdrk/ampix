import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { fieldLook } from '../../../components/ui/input';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { PageShell } from '../../../components/layout/PageShell';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type {
  ClickHeatmapQuery,
  ClickHeatmapResponse,
  HeatmapGrid,
  TapElementsResponse,
} from '../../../lib/api/types';
import { useRunClickHeatmap, useRunTapElements, useScreens } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { ChartCard } from './charts/ChartCard';
import { KpiTile } from './charts/KpiTile';
import { HeatmapCanvas, HeatmapLegend, squareHeatmapGrid } from './HeatmapCanvas';
import { RetakeScreenButton } from './RetakeScreenButton';

export function HeatmapPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/heatmap' });
  const screens = useScreens(projectId);
  const runHeatmap = useRunClickHeatmap(projectId);
  // Run alongside the heatmap, from the same selection: on a screen taller than the viewport the
  // positional view cannot be trusted, and this one still can.
  const runTapElements = useRunTapElements(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Heatmap shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo } = useDateRange();
  // Global Filters Bar (feat-02): AND-joins onto the heatmap query's filters right before sending.
  const { filters: globalFilters } = useGlobalFilters();

  const [selectedScreen, setSelectedScreen] = useState('');
  const [opacity, setOpacity] = useState(0.85);
  const [result, setResult] = useState<ClickHeatmapResponse | null>(null);
  const [elements, setElements] = useState<TapElementsResponse | null>(null);
  // The grid the CURRENT result was bucketed into — it depends on the screen's capture shape, so
  // it is captured at run time and reused for rendering rather than recomputed while the cells are
  // still those of the previous screen.
  const [activeGrid, setActiveGrid] = useState<HeatmapGrid>(() => squareHeatmapGrid());

  const screenList = screens.data?.screens ?? [];
  const selectedSummary = screenList.find((s) => s.screen_name === selectedScreen);

  const run = (screenName: string) => {
    if (!screenName || !dateFrom || !dateTo) return;
    // Sized from THIS screen's capture, looked up by name: `selectedSummary` still points at the
    // previous screen when `onSelectScreen` runs, because the state update has not landed yet.
    const grid = squareHeatmapGrid(screenList.find((s) => s.screen_name === screenName));
    const query: ClickHeatmapQuery = {
      screen_name: screenName,
      date_range: { from: dateFrom, to: dateTo },
      grid,
      filters: mergeGlobalFilters([], globalFilters),
    };
    setActiveGrid(grid);
    runHeatmap.mutate(query, { onSuccess: setResult });
    runTapElements.mutate(
      {
        screen_name: screenName,
        date_range: { from: dateFrom, to: dateTo },
        filters: mergeGlobalFilters([], globalFilters),
      },
      { onSuccess: setElements },
    );
  };

  const onSelectScreen = (screenName: string) => {
    setSelectedScreen(screenName);
    setResult(null);
    setElements(null);
    run(screenName);
  };

  const maxCount = useMemo(
    () => (result ? result.cells.reduce((max, cell) => Math.max(max, cell.count), 0) : 0),
    [result],
  );
  const hasTaps = result !== null && result.total > 0 && result.cells.length > 0;

  return (
    <PageShell
      projectId={projectId}
      title="Click heatmap"
      description="See where users tap on a screen — taps bucketed into a grid and overlaid on the real screenshot."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Heatmap' }]}
      dateRangeControl={<DateRangeControl />}
    >
      <Reveal index={0}>
        <Card>
          <CardHeader>
            <CardTitle>Heatmap builder</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div>
              <label htmlFor="heatmap-screen" className="mb-1 block text-sm font-medium">
                Screen
              </label>
              <select
                id="heatmap-screen"
                value={selectedScreen}
                onChange={(e) => onSelectScreen(e.target.value)}
                className={cn(fieldLook, 'w-auto')}
              >
                <option value="">Select a screen…</option>
                {screenList.map((screen) => (
                  <option key={screen.screen_name} value={screen.screen_name}>
                    {screen.screen_name}
                  </option>
                ))}
              </select>
              {screens.isSuccess && screenList.length === 0 && (
                <p className="mt-2 text-sm text-text-muted">No screens captured yet.</p>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <Button onClick={() => run(selectedScreen)} disabled={!selectedScreen || runHeatmap.isPending}>
                {runHeatmap.isPending ? 'Running…' : 'Run'}
              </Button>
              <div>
                <label htmlFor="heatmap-opacity" className="mb-1 block text-sm font-medium">
                  Heatmap opacity
                </label>
                <input
                  id="heatmap-opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="accent-[var(--accent)]"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {runHeatmap.isError && (
        <Reveal index={1}>
          <p role="alert" className="text-danger">
            {runHeatmap.error instanceof ApiError
              ? runHeatmap.error.problem.title
              : 'Failed to load the heatmap'}
          </p>
        </Reveal>
      )}

      {selectedScreen && (
        <Reveal index={2}>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <div className="text-sm font-medium">{selectedScreen}</div>
                <div className="text-xs text-text-muted">
                  Reference screenshot — a developer debug capture (§18).
                </div>
              </div>
              <RetakeScreenButton
                projectId={projectId}
                screenName={selectedScreen}
                onDeleted={() => {
                  setSelectedScreen('');
                  setResult(null);
                }}
              />
            </CardContent>
          </Card>
        </Reveal>
      )}

      {selectedScreen && result && (
        <Reveal index={3} className="flex flex-col gap-4">
          <SectionGrid min={220}>
            <KpiTile label="Total taps" value={result.total} />
          </SectionGrid>

          <ChartCard
            title="Heatmap"
            state={hasTaps ? 'ready' : 'empty'}
            emptyText="No taps recorded for this screen in the selected range."
          >
            <div className="flex flex-col gap-4">
              <HeatmapLegend total={result.total} maxCount={maxCount} />
              <HeatmapCanvas
                projectId={projectId}
                screenName={selectedScreen}
                summary={selectedSummary}
                result={result}
                grid={activeGrid}
                maxCount={maxCount}
                opacity={opacity}
              />
            </div>
          </ChartCard>

          <ChartCard
            title="Most-tapped elements"
            state={elements && elements.elements.length > 0 ? 'ready' : 'empty'}
            emptyText="No taps recorded for this screen in the selected range."
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">
                What was tapped, rather than where. Tap positions are recorded relative to the
                visible screen and carry no scroll offset, so on a screen taller than one viewport
                the heatmap above cannot place them against the screenshot — this list stays exact
                either way.
              </p>
              {elements && <TapElementsTable data={elements} />}
            </div>
          </ChartCard>
        </Reveal>
      )}
    </PageShell>
  );
}

/** The ranked list: what was tapped, how often, and by how many people. */
function TapElementsTable({ data }: { data: TapElementsResponse }) {
  const max = data.elements.reduce((m, e) => Math.max(m, e.count), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Most-tapped elements</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Element</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Taps</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Users</th>
            <th scope="col" className="py-2 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {data.elements.map((element) => {
            const label = element.widget_label || element.widget_type;
            return (
              <tr
                key={`${element.widget_type}|${element.widget_label}`}
                className="border-t border-border"
              >
                <td className="py-2 pr-4">
                  {/* A tap that hit no identifiable widget is shown, not hidden: a screen whose
                      taps are mostly unidentified is itself the finding. */}
                  {label ? (
                    <span className="font-medium">{label}</span>
                  ) : (
                    <span className="text-text-muted">Unidentified element</span>
                  )}
                  {element.widget_label && element.widget_type && (
                    <span className="ml-2 text-xs text-text-muted">{element.widget_type}</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{element.count}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{element.users}</td>
                <td className="w-1/3 py-2">
                  <div className="h-2 rounded-full bg-surface-raised">
                    <div
                      className="h-2 rounded-full bg-accent"
                      style={{ width: `${max > 0 ? (element.count / max) * 100 : 0}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.truncated && (
        <p className="pt-2 text-xs text-text-muted">
          Showing the top {data.elements.length} elements — more were tapped on this screen.
        </p>
      )}
    </div>
  );
}
