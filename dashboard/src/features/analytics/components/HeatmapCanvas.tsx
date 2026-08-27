import type { ClickHeatmapResponse, HeatmapGrid, ScreenSummary } from '../../../lib/api/types';
import { cn } from '../../../lib/cn';
import { formatExactNumber } from '../format';
import { SEQUENTIAL_BLUE_RAMP, sequentialColor } from '../palette';
import { ScreenImage } from './ScreenImage';

/**
 * The heatmap overlay + legend, extracted from HeatmapPage so both the aggregate heatmap viewer and
 * the per-user profile heatmap can reuse the exact same rendering (same cells, palette, and layout).
 */

export function HeatmapLegend({ total, maxCount }: { total: number; maxCount: number }) {
  const gradient = `linear-gradient(to right, ${SEQUENTIAL_BLUE_RAMP.join(', ')})`;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div>
        <div className="font-display text-2xl font-semibold tabular-nums">
          {formatExactNumber(total)}
        </div>
        <div className="text-xs text-text-muted">total taps</div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="h-3 w-48 rounded-full border border-border" style={{ background: gradient }} />
        <div className="flex justify-between text-xs tabular-nums text-text-muted">
          <span>0</span>
          <span>{formatExactNumber(maxCount)}</span>
        </div>
      </div>
    </div>
  );
}

export function HeatmapCanvas({
  projectId,
  screenName,
  summary,
  result,
  grid,
  maxCount,
  opacity,
}: {
  projectId: string;
  screenName: string;
  summary?: ScreenSummary;
  result: ClickHeatmapResponse;
  grid: HeatmapGrid;
  maxCount: number;
  opacity: number;
}) {
  // The screenshot keeps its aspect ratio; normalized [0,1] cell coords map onto the displayed box.
  // For a stitched full-page capture that box IS the whole page, which is exactly why the heatmap's
  // rows now span content height — the grid lines up with the image without any special casing.
  const aspectRatio =
    summary && summary.width > 0 && summary.height > 0
      ? `${summary.width} / ${summary.height}`
      : '9 / 19.5';

  // How many screens tall the capture is, when it covers more than one.
  const screensTall =
    summary?.content_height && summary.viewport_height && summary.viewport_height > 0
      ? summary.content_height / summary.viewport_height
      : null;

  return (
    <div className="flex flex-col gap-2">
      {screensTall !== null && screensTall > 1 && (
        <p className="text-center text-xs text-text-muted">
          Full-page capture — {screensTall.toFixed(1)}× screen height. Taps are placed against the
          whole page, not the visible screen.
        </p>
      )}
      {/* A 6-viewport page is far taller than any useful viewport, so the image scrolls inside a
          bounded box rather than pushing the rest of the page off screen. */}
      <div
        className={cn(
          'mx-auto w-full max-w-xs',
          screensTall !== null && screensTall > 1 && 'max-h-[75vh] overflow-y-auto',
        )}
      >
    <ScreenImage
      projectId={projectId}
      screenName={screenName}
      alt={`Screenshot of ${screenName}`}
      cacheKey={summary?.latest_image_hash}
      className="w-full rounded-xl border border-border shadow-sm"
      aspectRatio={aspectRatio}
    >
      <div className="pointer-events-none absolute inset-0" style={{ opacity }} aria-hidden={false}>
        {result.cells.map((cell) => {
          const intensity = maxCount > 0 ? cell.count / maxCount : 0;
          return (
            <div
              key={`${cell.cx}-${cell.cy}`}
              data-testid="heatmap-cell"
              title={`${formatExactNumber(cell.count)} taps`}
              className="pointer-events-auto absolute"
              style={{
                left: `${(cell.cx / grid.cols) * 100}%`,
                top: `${(cell.cy / grid.rows) * 100}%`,
                width: `${100 / grid.cols}%`,
                height: `${100 / grid.rows}%`,
                backgroundColor: sequentialColor(intensity),
              }}
            />
          );
        })}
      </div>
    </ScreenImage>
      </div>
    </div>
  );
}
