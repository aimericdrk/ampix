import { GripVertical, Inbox } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import type { AnalysisResult, ReportKind } from '../../../lib/api/types';
import { isTileError } from '../../../lib/api/types';
import { analysisResultIsEmpty, ReportChart } from './ReportChart';

export interface GridTile {
  id: string;
  title: string;
  kind: ReportKind;
  w: number;
  h: number;
}

const MIN_SPAN = 1;
const MAX_COLS = 12;
const MAX_ROWS = 6;
const ROW_HEIGHT_PX = 132;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Left-to-right, top-to-bottom shelf packing across the 12 columns → each tile's persisted x/y. */
export function packLayout(tiles: GridTile[]): {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
}[] {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return tiles.map((tile, index) => {
    const w = clamp(tile.w, MIN_SPAN, MAX_COLS);
    const h = clamp(tile.h, MIN_SPAN, MAX_ROWS);
    if (x + w > MAX_COLS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const placed = { id: tile.id, x, y, w, h, position: index };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    return placed;
  });
}

/**
 * A 12-column CSS-Grid board. Reordering uses native pointer events (drag a tile's handle over
 * another tile) plus accessible Move earlier/later buttons; sizing is DISCRETE — per-tile
 * column-span and height steppers, never free-form drag-resize (contracts §16, and far less
 * bug-prone). No drag-and-drop dependency is used.
 *
 * `readOnly` (feat-16, Presentation/TV mode) hides every edit affordance — drag handle, move,
 * resize, remove — leaving just the title + tile body; `onReorder`/`onResize`/`onRemove` are
 * unused in that mode and become optional. `rowHeightPx` lets a bigger surface (the presentation
 * overlay) render noticeably larger tiles without duplicating the tile-rendering logic.
 */
export function DashboardGrid({
  tiles,
  results,
  loading,
  onReorder,
  onResize,
  onRemove,
  readOnly = false,
  rowHeightPx = ROW_HEIGHT_PX,
}: {
  tiles: GridTile[];
  results: Map<string, AnalysisResult | { error: string }>;
  loading: boolean;
  onReorder?: (from: number, to: number) => void;
  onResize?: (id: string, size: { w?: number; h?: number }) => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
  rowHeightPx?: number;
}) {
  const positioned = packLayout(tiles);
  const draggingId = useRef<string | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    draggingId.current = id;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingId.current) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const tileEl = under?.closest('[data-tile-id]') as HTMLElement | null;
    const overId = tileEl?.dataset.tileId;
    if (!overId || overId === draggingId.current) return;
    const from = tiles.findIndex((t) => t.id === draggingId.current);
    const to = tiles.findIndex((t) => t.id === overId);
    if (from >= 0 && to >= 0) onReorder?.(from, to);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    draggingId.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  if (tiles.length === 0) {
    return <EmptyState icon={Inbox} title="No tiles yet." description="Add one from a saved report." />;
  }

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${MAX_COLS}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeightPx}px`,
        gridAutoFlow: 'row dense',
      }}
    >
      {positioned.map((placed, index) => {
        const tile = tiles[index];
        if (!tile) return null;
        const result = results.get(tile.id);
        return (
          <article
            key={tile.id}
            data-tile-id={tile.id}
            aria-label={tile.title}
            className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-all duration-250"
            style={{
              gridColumn: `${placed.x + 1} / span ${placed.w}`,
              gridRow: `span ${placed.h}`,
            }}
          >
            <header className="flex flex-wrap items-center gap-1 border-b border-border p-2">
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Reorder ${tile.title}`}
                  onPointerDown={(e) => handlePointerDown(e, tile.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="cursor-grab rounded px-1 text-text-muted hover:bg-border/40"
                  title="Drag to reorder"
                >
                  <GripVertical aria-hidden="true" size={14} />
                </button>
              )}
              <span className="flex-1 truncate text-sm font-medium">{tile.title}</span>

              {!readOnly && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${tile.title} earlier`}
                    disabled={index === 0}
                    onClick={() => onReorder?.(index, index - 1)}
                  >
                    ←
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${tile.title} later`}
                    disabled={index === tiles.length - 1}
                    onClick={() => onReorder?.(index, index + 1)}
                  >
                    →
                  </Button>

                  <span className="ml-1 text-xs tabular-nums text-text-muted" aria-hidden="true">
                    {tile.w}×{tile.h}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Decrease width of ${tile.title}`}
                    disabled={tile.w <= MIN_SPAN}
                    onClick={() => onResize?.(tile.id, { w: clamp(tile.w - 1, MIN_SPAN, MAX_COLS) })}
                  >
                    W−
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Increase width of ${tile.title}`}
                    disabled={tile.w >= MAX_COLS}
                    onClick={() => onResize?.(tile.id, { w: clamp(tile.w + 1, MIN_SPAN, MAX_COLS) })}
                  >
                    W+
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Decrease height of ${tile.title}`}
                    disabled={tile.h <= MIN_SPAN}
                    onClick={() => onResize?.(tile.id, { h: clamp(tile.h - 1, MIN_SPAN, MAX_ROWS) })}
                  >
                    H−
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Increase height of ${tile.title}`}
                    disabled={tile.h >= MAX_ROWS}
                    onClick={() => onResize?.(tile.id, { h: clamp(tile.h + 1, MIN_SPAN, MAX_ROWS) })}
                  >
                    H+
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${tile.title}`}
                    onClick={() => onRemove?.(tile.id)}
                  >
                    Remove
                  </Button>
                </>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              <TileBody kind={tile.kind} result={result} loading={loading} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TileBody({
  kind,
  result,
  loading,
}: {
  kind: ReportKind;
  result: AnalysisResult | { error: string } | undefined;
  loading: boolean;
}) {
  if (!result) {
    return loading ? (
      <p role="status" className="text-sm text-text-muted">
        Loading…
      </p>
    ) : (
      <p className="text-sm text-text-muted">No data.</p>
    );
  }
  if (isTileError(result)) {
    return (
      <p role="alert" className="text-sm text-danger">
        {result.error}
      </p>
    );
  }
  if (analysisResultIsEmpty(kind, result)) {
    return <p className="text-sm text-text-muted">No data for this tile yet.</p>;
  }
  return <ReportChart kind={kind} result={result} />;
}
