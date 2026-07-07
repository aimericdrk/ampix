import { type ReactNode } from 'react';
import { Card } from '../../../../components/ui/card';
import { formatCompactNumber } from '../../format';
import { Sparkline } from './sparkline';

/**
 * A single headline metric — dataviz "the answer is not a chart, it's a number". Big value in
 * primary ink, a muted label, an optional trailing sparkline (magnitude-over-time context, no axes)
 * and an optional delta. The delta carries its meaning in TEXT (an arrow glyph + sign), never color
 * alone, so it stays legible in mono / forced-colors / CVD. An accessible summary sits in the
 * aria-label; the sparkline is decorative (aria-hidden) because its values back a nearby number.
 * See `KpiTile` for the heavier-weight variant (full-precision value, coloured delta chip, and a
 * `loading` skeleton state) used for Phase 1 headline KPIs.
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
