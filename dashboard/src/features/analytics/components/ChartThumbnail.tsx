import type { AnalysisResult, ReportKind } from '../../../lib/api/types';
import { ReportChart } from './ReportChart';

export type ChartThumbnailState = 'loading' | 'error' | 'empty' | 'ready';

/**
 * A small, purely DECORATIVE preview of a saved report / dashboard tile, rendered by reusing the
 * live per-kind charts (`ReportChart`). The underlying charts ship a legend + an accessible data
 * table, so the whole thumbnail is `aria-hidden` + `pointer-events-none`: the card's own name link
 * stays the single accessible/clickable handle. The chart is rendered at full size inside an
 * over-wide box, then scaled down and clipped by the fixed-height frame so it reads as a mini chart.
 */
export function ChartThumbnail({
  kind,
  result,
  state,
  emptyLabel = 'No data yet',
}: {
  kind: ReportKind;
  result?: AnalysisResult;
  state: ChartThumbnailState;
  /** Copy for the `empty` state (e.g. "Empty board" for a zero-tile dashboard). */
  emptyLabel?: string;
}) {
  return (
    <div
      data-testid="chart-thumbnail"
      aria-hidden="true"
      className="pointer-events-none h-28 overflow-hidden rounded-md border border-border bg-chart-surface"
    >
      {state === 'loading' && (
        <div className="h-full w-full animate-pulse bg-border/40" data-testid="chart-thumbnail-skeleton" />
      )}

      {state === 'error' && (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-text-muted">
          Preview unavailable
        </div>
      )}

      {state === 'empty' && (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-text-muted">
          {emptyLabel}
        </div>
      )}

      {state === 'ready' && result && (
        // Render the real chart at ~2.5× the card width, then scale it back down so a 320px-tall
        // chart collapses to ~128px and fills the card. The outer box clips the legend/table overflow.
        <div className="origin-top-left scale-[0.4]" style={{ width: '250%' }}>
          <ReportChart kind={kind} result={result} />
        </div>
      )}
    </div>
  );
}
