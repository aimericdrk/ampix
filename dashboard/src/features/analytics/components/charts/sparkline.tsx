import { useId } from 'react';
import { SeriesGradient } from './chart-theme';

/**
 * A tiny, axis-less trend line — inline SVG (not recharts) so it stays crisp at ~32px and is
 * dependency-free. 2px stroke in series-1, a soft `var(--accent)` gradient area fill under the
 * line (the tile's own accent, not a data-encoded series color — this reads as decorative chrome,
 * matching how KPI tiles use the sparkline as a faint backdrop), and a ≥8px end marker anchored to
 * the last point with a 2px surface ring (dataviz mark spec). Decorative: the values back a
 * headline number beside it. Shared by `StatTile` and `KpiTile`.
 */
export function Sparkline({
  values,
  width = 96,
  height = 32,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const gradientId = useId();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath =
    first && last
      ? `${path} L${last[0].toFixed(1)},${height} L${first[0].toFixed(1)},${height} Z`
      : undefined;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <defs>
        <SeriesGradient id={gradientId} color="var(--accent)" />
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />}
      <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {last && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={4}
          fill="var(--series-1)"
          stroke="var(--chart-surface)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
