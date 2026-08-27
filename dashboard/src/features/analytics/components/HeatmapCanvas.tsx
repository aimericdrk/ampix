import type { ClickHeatmapResponse, HeatmapGrid, ScreenSummary } from '../../../lib/api/types';
import { cn } from '../../../lib/cn';
import { formatExactNumber } from '../format';
import { SEQUENTIAL_BLUE_RAMP, sequentialColor } from '../palette';
import { ScreenImage } from './ScreenImage';

/**
 * The heatmap overlay + legend, extracted from HeatmapPage so both the aggregate heatmap viewer and
 * the per-user profile heatmap can reuse the exact same rendering (same cells, palette, and layout).
 */

/** Shape assumed for a screen with no stored capture yet — a portrait phone. */
const FALLBACK_ASPECT = { width: 9, height: 19.5 };

/** Horizontal resolution: one cell is 1/20th of the image width. Rows follow from the aspect. */
const HEATMAP_COLS = 20;
/** Must stay within the API's grid bounds (backend click-heatmap.schema.ts). */
const MAX_COLS = 100;
const MAX_ROWS = 400;

/**
 * The displayed size of a screen's stored capture — the box the heatmap grid is stretched over.
 * For a stitched full-page screenshot this is the whole page, several viewports tall.
 */
function captureAspect(summary?: Pick<ScreenSummary, 'width' | 'height'>) {
  return summary && summary.width > 0 && summary.height > 0
    ? { width: summary.width, height: summary.height }
    : FALLBACK_ASPECT;
}

/**
 * The grid to bucket taps into, so that a cell comes out SQUARE over this particular capture.
 *
 * The two axes measure different things — columns span one screen width, rows span the capture's
 * full content height — so a fixed `cols x rows` only looks right at the one aspect it was picked
 * for. Over a full-page capture N viewports tall, a fixed grid stretches every cell to N times its
 * width, and the heatmap draws tall bars instead of tap-sized spots. Deriving rows from the same
 * aspect the image is displayed at keeps a cell square at any page height.
 *
 * Past `MAX_ROWS` the grid stops growing and columns shrink instead: squareness is preserved, at a
 * coarser resolution, rather than letting the cells distort again at the extreme.
 */
export function squareHeatmapGrid(summary?: Pick<ScreenSummary, 'width' | 'height'>): HeatmapGrid {
  const { width, height } = captureAspect(summary);
  const rows = Math.round(HEATMAP_COLS * (height / width));
  if (rows <= MAX_ROWS) return { cols: HEATMAP_COLS, rows: Math.max(1, rows) };
  const cols = Math.round(MAX_ROWS * (width / height));
  return { cols: Math.min(MAX_COLS, Math.max(1, cols)), rows: MAX_ROWS };
}

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
  // Same source as `squareHeatmapGrid`, so the cells stay square against whatever is displayed.
  const shape = captureAspect(summary);
  const aspectRatio = `${shape.width} / ${shape.height}`;

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
