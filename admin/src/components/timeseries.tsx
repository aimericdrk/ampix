'use client';

import { useMemo, useRef, useState } from 'react';
import { clientXToViewBoxX, fmtValue, niceTicks, timeTickLabel, type Point } from '@/lib/history';
import { Card, usePoll } from '@/components/ui';

/**
 * Time-series chart (dataviz method): x/y axes with recessive gridlines, thin 2px lines,
 * fixed-order validated categorical palette, and a crosshair that snaps to the nearest sample —
 * the tooltip lists EVERY series at that x (values lead, line-keyed names follow).
 */

// Reference dark categorical palette — validated on this surface (#09090b), fixed order, never cycled.
export const SERIES_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

export interface Series {
  name: string;
  points: Point[];
}

const W = 640;
const H = 240;
const M = { left: 48, right: 8, top: 10, bottom: 26 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

interface Hover {
  t: number;
  xPx: number; // svg x of the snapped time
  ptrX: number; // pointer x fraction (0..1) across the container, for tooltip side
}

export function TimeSeriesChart({
  title,
  unit,
  series,
  hours,
  yMax,
  height = 240,
}: {
  title: string;
  unit: string;
  series: Series[];
  hours: number;
  yMax?: number;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const shown = series.filter((s) => s.points.length > 0).slice(0, SERIES_COLORS.length);
  const now = useMemo(() => Date.now(), [series]); // eslint-disable-line react-hooks/exhaustive-deps
  const t0 = now - hours * 3600_000;
  const allValues = shown.flatMap((s) => s.points.map((p) => p.v));
  const ticks = niceTicks(
    yMax ?? (allValues.length > 0 ? Math.max(...allValues) : 1),
    4,
    0,
    unit === '',
  );
  const top = ticks[ticks.length - 1]!;
  const x = (t: number): number => M.left + ((t - t0) / (now - t0)) * PW;
  const y = (v: number): number => M.top + PH - (v / top) * PH;

  // Snap targets: union of every series' bucket midpoints.
  const times = useMemo(
    () => [...new Set(shown.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series],
  );

  const xTickCount = 5;
  const xTicks = Array.from(
    { length: xTickCount },
    (_, i) => t0 + ((i + 0.5) / xTickCount) * (now - t0),
  );

  const onMove = (e: React.PointerEvent<SVGRectElement>): void => {
    if (times.length === 0) return;
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement | null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // The svg is `w-full` with a fixed pixel height and the default
    // preserveAspectRatio="xMidYMid meet", so the 640-unit drawing is scaled to fit and CENTRED —
    // in a two-column grid that leaves ~30px of dead space each side. Converting the pointer with
    // a plain element fraction ignores that inset and lands the crosshair ~30px right of the
    // pointer (see clientXToViewBoxX's regression test).
    const svgX = clientXToViewBoxX(e.clientX, rect, W, H);
    const tPointer = t0 + ((svgX - M.left) / PW) * (now - t0);
    let best = times[0]!;
    for (const t of times) if (Math.abs(t - tPointer) < Math.abs(best - tPointer)) best = t;
    // Tooltip side is a container-relative question, not a viewBox one — keep it in element space.
    const cRect = containerRef.current?.getBoundingClientRect() ?? rect;
    const ptrX = cRect.width > 0 ? (e.clientX - cRect.left) / cRect.width : 0.5;
    setHover({ t: best, xPx: x(best), ptrX: Math.min(1, Math.max(0, ptrX)) });
  };

  const hoverRows = hover
    ? shown
        .map((s, i) => {
          const p = s.points.find((q) => q.t === hover.t) ?? null;
          return p ? { name: s.name, color: SERIES_COLORS[i]!, v: p.v } : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    : [];

  return (
    <Card title={title}>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-600">
          No samples yet — data appears as the sampler runs.
        </p>
      ) : (
        <div ref={containerRef} className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ height }}
            className="w-full select-none"
            role="img"
            aria-label={title}
          >
            {/* recessive horizontal gridlines + y labels */}
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="#27272a"
                  strokeWidth="1"
                />
                <text x={M.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#71717a">
                  {fmtValue(v, unit)}
                </text>
              </g>
            ))}
            {/* x labels */}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#71717a">
                {timeTickLabel(t, hours)}
              </text>
            ))}
            {/* baseline */}
            <line
              x1={M.left}
              x2={W - M.right}
              y1={M.top + PH}
              y2={M.top + PH}
              stroke="#3f3f46"
              strokeWidth="1"
            />
            {/* series: subtle area for a single series, 2px lines always */}
            {shown.map((s, i) => {
              const d = s.points
                .map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
                .join(' ');
              const first = s.points[0]!;
              const last = s.points[s.points.length - 1]!;
              return (
                <g key={s.name}>
                  {shown.length === 1 ? (
                    <path
                      d={`${d} L${x(last.t).toFixed(1)},${y(0)} L${x(first.t).toFixed(1)},${y(0)} Z`}
                      fill={SERIES_COLORS[i]}
                      fillOpacity="0.08"
                      stroke="none"
                    />
                  ) : null}
                  <path
                    d={d}
                    fill="none"
                    stroke={SERIES_COLORS[i]}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {/* crosshair + snapped markers */}
            {hover ? (
              <g pointerEvents="none">
                <line
                  x1={hover.xPx}
                  x2={hover.xPx}
                  y1={M.top}
                  y2={M.top + PH}
                  stroke="#52525b"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {hoverRows.map((r) => (
                  <circle
                    key={r.name}
                    cx={hover.xPx}
                    cy={y(r.v)}
                    r="3.5"
                    fill={r.color}
                    stroke="#09090b"
                    strokeWidth="1.5"
                  />
                ))}
              </g>
            ) : null}
            {/* full-plot hit target — the crosshair finds the X, nobody aims at a 2px line */}
            <rect
              x={M.left}
              y={M.top}
              width={PW}
              height={PH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
          {hover && hoverRows.length > 0 ? (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-lg"
              style={
                hover.ptrX < 0.55
                  ? { left: `${hover.ptrX * 100}%`, marginLeft: 16 }
                  : { right: `${(1 - hover.ptrX) * 100}%`, marginRight: 16 }
              }
            >
              <div className="mb-1 text-[11px] text-zinc-500">
                {new Date(hover.t).toLocaleString()}
              </div>
              {hoverRows.map((r) => (
                <div key={r.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-0.5 w-3 rounded"
                    style={{ background: r.color }}
                  />
                  <span className="font-semibold tabular-nums text-zinc-100">
                    {fmtValue(r.v, unit)}
                  </span>
                  <span className="text-xs text-zinc-400">{r.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          {/* legend: present for ≥2 series; a single series is named by the title */}
          {shown.length >= 2 ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {shown.map((s, i) => (
                <span key={s.name} className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span
                    className="inline-block h-0.5 w-4 rounded"
                    style={{ background: SERIES_COLORS[i] }}
                  />
                  {s.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export interface HistoryPayload {
  series: Record<string, Point[]>;
  hours: number;
}

/** Fetches bucketed history and groups keys under a prefix into chart series (entity-stable order). */
export function useHistory(
  query: string,
  refreshMs = 60_000,
): { data: HistoryPayload | null; error: string | null; at: Date | null; refresh: () => void } {
  return usePoll<HistoryPayload>(`/api/admin/history?${query}`, refreshMs);
}

export function seriesFor(data: HistoryPayload | null, prefix: string): Series[] {
  if (!data) return [];
  return Object.entries(data.series)
    .filter(([k]) => k.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b)) // stable → colors follow the entity, not the rank
    .map(([k, points]) => ({ name: k.slice(prefix.length) || k, points }));
}

export function singleSeries(data: HistoryPayload | null, key: string, name: string): Series[] {
  const points = data?.series[key];
  return points && points.length > 0 ? [{ name, points }] : [];
}
