import { type ReactNode } from 'react';
import { Card } from '../../../../components/ui/card';
import { formatCompactNumber } from '../../format';

/**
 * A single headline metric — dataviz "the answer is not a chart, it's a number". Big value in
 * primary ink, a muted label, an optional trailing sparkline (magnitude-over-time context, no axes)
 * and an optional delta. The delta carries its meaning in TEXT (an arrow glyph + sign), never color
 * alone, so it stays legible in mono / forced-colors / CVD. An accessible summary sits in the
 * aria-label; the sparkline is decorative (aria-hidden) because its values back a nearby number.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  spark,
}: {
  label: string;
  /** A pre-formatted string, or a number that gets compact-formatted (1,284 → 1.3K). */
  value: string | number;
  hint?: ReactNode;
  /** A period-over-period change; `direction` picks the arrow, `label` is the human copy. */
  delta?: { direction: 'up' | 'down' | 'flat'; label: string };
  /** Sparkline series (oldest → newest); needs ≥ 2 points to draw. */
  spark?: number[];
}) {
  const display = typeof value === 'number' ? formatCompactNumber(value) : value;
  const arrow = delta ? (delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '→') : '';

  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-text-muted">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tabular-nums leading-none">{display}</p>
        {spark && spark.length >= 2 && <Sparkline values={spark} />}
      </div>
      {delta && (
        <p className="mt-2 text-xs tabular-nums text-text-muted">
          <span aria-hidden="true">{arrow} </span>
          {delta.label}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}

/**
 * A tiny, axis-less trend line — inline SVG (not recharts) so it stays crisp at ~32px and is
 * dependency-free. 2px stroke in series-1, a ≥8px end marker anchored to the last point with a 2px
 * surface ring (dataviz mark spec). Decorative: the values back a headline number beside it.
 */
function Sparkline({ values, width = 96, height = 32 }: { values: number[]; width?: number; height?: number }) {
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
