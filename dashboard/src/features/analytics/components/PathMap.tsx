import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/cn';
import type { FlowLink, FlowNode } from '../../../lib/api/types';
import { formatCompactNumber, formatExactNumber } from '../format';
import { ScreenImage } from './ScreenImage';
import {
  computePathLayout,
  edgePath,
  edgeStrokeWidth,
  isSyntheticScreen,
  NODE_HEIGHT,
  NODE_WIDTH,
  screenLabel,
  type PositionedNode,
} from './path-layout';

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.2;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

/**
 * The interactive user-path map: a pan/zoom canvas of screen cards laid out in columns by step, with
 * SVG transition edges whose width encodes volume (value on hover). Pan by pointer drag, zoom by wheel
 * or the buttons — all via a single CSS transform on the stage (no layout dependency, no re-layout).
 */
export function PathMap({
  projectId,
  nodes,
  links,
  screenHashes,
  fullHeight = false,
}: {
  projectId: string;
  nodes: FlowNode[];
  links: FlowLink[];
  /** screen_name → latest `image_hash`, so each node's screenshot is content-addressed (retake-safe). */
  screenHashes?: Map<string, string>;
  /** Fill the parent (fullscreen overlay) instead of the default fixed 560px height. */
  fullHeight?: boolean;
}) {
  const layout = useMemo(() => computePathLayout(nodes, links), [nodes, links]);
  const [transform, setTransform] = useState<Transform>({ x: 24, y: 24, scale: 1 });
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((prev) => ({
      ...prev,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    setTransform((prev) => ({ ...prev, scale: clampScale(prev.scale - Math.sign(event.deltaY) * ZOOM_STEP) }));
  };

  const zoomBy = (delta: number) =>
    setTransform((prev) => ({ ...prev, scale: clampScale(prev.scale + delta) }));
  const resetView = () => setTransform({ x: 24, y: 24, scale: 1 });

  return (
    <div className={cn('flex flex-col gap-2', fullHeight && 'h-full')}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Drag to pan, scroll to zoom.</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)}>
            −
          </Button>
          <Button variant="secondary" size="sm" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </Button>
          <Button variant="secondary" size="sm" onClick={resetView}>
            Reset
          </Button>
        </div>
      </div>

      <div
        data-testid="path-map"
        role="group"
        aria-label="Interactive user path map"
        className={cn(
          'relative w-full cursor-grab touch-none overflow-hidden rounded-xl border border-border bg-chart-surface active:cursor-grabbing',
          fullHeight ? 'h-full flex-1' : 'h-[560px]',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                data-testid="path-edge"
                d={edgePath(edge.source, edge.target)}
                fill="none"
                stroke="var(--series-1)"
                strokeOpacity={0.35}
                strokeWidth={edgeStrokeWidth(edge.value, layout.maxValue)}
                strokeLinecap="round"
              >
                <title>
                  {screenLabel(edge.source.event)} → {screenLabel(edge.target.event)}:{' '}
                  {formatExactNumber(edge.value)}
                </title>
              </path>
            ))}
          </svg>

          {layout.nodes.map((node) => (
            <PathNodeCard
              key={node.id}
              projectId={projectId}
              node={node}
              cacheKey={screenHashes?.get(node.event)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PathNodeCard({
  projectId,
  node,
  cacheKey,
}: {
  projectId: string;
  node: PositionedNode;
  cacheKey?: string;
}) {
  const synthetic = isSyntheticScreen(node.event);
  return (
    <div
      data-testid="path-node"
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-xl border shadow-sm',
        synthetic ? 'border-dashed border-border bg-surface/60' : 'border-border bg-surface',
      )}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      {synthetic ? (
        <div
          aria-hidden="true"
          className="flex flex-1 items-center justify-center bg-chart-surface text-3xl text-text-muted"
        >
          {node.event === '$end' ? '⤓' : '…'}
        </div>
      ) : (
        <ScreenImage
          projectId={projectId}
          screenName={node.event}
          alt={`Screenshot of ${node.event}`}
          cacheKey={cacheKey}
          className="flex-1"
        />
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
        <span className="truncate text-xs font-medium" title={screenLabel(node.event)}>
          {screenLabel(node.event)}
        </span>
        <span
          className="shrink-0 text-xs tabular-nums text-text-muted"
          title={`${formatExactNumber(node.value)} users`}
        >
          {formatCompactNumber(node.value)}
        </span>
      </div>
    </div>
  );
}
