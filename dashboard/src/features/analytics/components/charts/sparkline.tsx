/**
 * A tiny, axis-less trend line — inline SVG (not recharts) so it stays crisp at ~32px and is
 * dependency-free. 2px stroke in series-1, a ≥8px end marker anchored to the last point with a 2px
 * surface ring (dataviz mark spec). Decorative: the values back a headline number beside it.
 * Shared by `StatTile` and `KpiTile`.
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

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
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
