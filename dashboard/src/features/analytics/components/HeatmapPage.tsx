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
import type { ClickHeatmapQuery, ClickHeatmapResponse, HeatmapGrid } from '../../../lib/api/types';
import { useRunClickHeatmap, useScreens } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { ChartCard } from './charts/ChartCard';
import { KpiTile } from './charts/KpiTile';
import { HeatmapCanvas, HeatmapLegend } from './HeatmapCanvas';
import { RetakeScreenButton } from './RetakeScreenButton';

const DEFAULT_GRID: HeatmapGrid = { cols: 20, rows: 40 };

export function HeatmapPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/heatmap' });
  const screens = useScreens(projectId);
  const runHeatmap = useRunClickHeatmap(projectId);
  // Time-scoped by the global range (Phase 2): seeded here and surfaced via `<DateRangeControl/>`
  // in the header, so Heatmap shares the same window as every other analytics page.
  const { from: dateFrom, to: dateTo } = useDateRange();
  // Global Filters Bar (feat-02): AND-joins onto the heatmap query's filters right before sending.
  const { filters: globalFilters } = useGlobalFilters();

  const [selectedScreen, setSelectedScreen] = useState('');
  const [opacity, setOpacity] = useState(0.85);
  const [result, setResult] = useState<ClickHeatmapResponse | null>(null);
  const [activeGrid, setActiveGrid] = useState<HeatmapGrid>(DEFAULT_GRID);

  const screenList = screens.data?.screens ?? [];
  const selectedSummary = screenList.find((s) => s.screen_name === selectedScreen);

  const run = (screenName: string) => {
    if (!screenName || !dateFrom || !dateTo) return;
    const query: ClickHeatmapQuery = {
      screen_name: screenName,
      date_range: { from: dateFrom, to: dateTo },
      grid: DEFAULT_GRID,
      filters: mergeGlobalFilters([], globalFilters),
    };
    setActiveGrid(DEFAULT_GRID);
    runHeatmap.mutate(query, { onSuccess: setResult });
  };

  const onSelectScreen = (screenName: string) => {
    setSelectedScreen(screenName);
    setResult(null);
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
        </Reveal>
      )}
    </PageShell>
  );
}
