import { type ReactNode } from 'react';
import { Card } from '../../../../components/ui/card';
import { Reveal } from '../../../../components/ui/reveal';
import { StatTile as UiStatTile } from '../../../../components/ui/stat-tile';
import { formatCompactNumber } from '../../format';
import { Sparkline } from './sparkline';

const LABEL_CLASS = 'block text-xs font-medium uppercase tracking-wide text-text-muted';

/**
 * A single headline metric — dataviz "the answer is not a chart, it's a number". Big value in
 * primary ink, a muted label, an optional trailing sparkline (magnitude-over-time context, no axes)
 * and an optional delta. The delta carries its meaning in TEXT (an arrow glyph + sign), never color
 * alone, so it stays legible in mono / forced-colors / CVD.
 *
 * Thin adapter over `ui/stat-tile.tsx`'s `StatTile` (Task 13): the animated number, entrance
 * reveal, and card chrome all come from there. `hint` and the text-only delta have no equivalent
 * on the generic tile, so they're composed back in via its `children` slot instead of growing its
 * prop surface. A pre-formatted `value` (e.g. "4m 5s") isn't a number `AnimatedNumber` can tween,
 * so that case renders a plain, unanimated value with the same layout instead of forcing it
 * through the ui tile.
 *
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
  const hasSpark = !!spark && spark.length >= 2;
  const sparkline = hasSpark ? <Sparkline values={spark as number[]} /> : undefined;
  const arrow = delta ? (delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '→') : '';

  const extras = (
    <>
      {delta && (
        <p className="mt-2 text-xs tabular-nums text-text-muted">
          <span aria-hidden="true">{arrow} </span>
          {delta.label}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </>
  );

  if (typeof value === 'number') {
    return (
      <UiStatTile label={label} value={value} format={formatCompactNumber} sparkline={sparkline}>
        {extras}
      </UiStatTile>
    );
  }

  return (
    <Reveal>
      <Card interactive className="relative overflow-hidden p-6">
        <span className={LABEL_CLASS}>{label}</span>
        <p className="mt-2 font-display text-3xl font-semibold tabular-nums">{value}</p>
        {extras}
        {sparkline ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 opacity-40">{sparkline}</div>
        ) : null}
      </Card>
    </Reveal>
  );
}
