import { type ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import { Card } from '../../../../components/ui/card';
import { Reveal } from '../../../../components/ui/reveal';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { StatTile as UiStatTile } from '../../../../components/ui/stat-tile';
import { formatExactNumber } from '../../format';
import { Sparkline } from './sparkline';

const LABEL_CLASS = 'block text-xs font-medium uppercase tracking-wide text-text-muted';

/**
 * The headline KPI primitive for Phase 1 pages: a big, full-precision number, an optional
 * sparkline for magnitude-over-time context, and a period-over-period delta chip. The delta
 * always pairs an arrow glyph with its colour (▲ accent / ▼ danger) so meaning survives
 * grayscale/CVD viewing. `loading` swaps the value and sparkline for `Skeleton` placeholders.
 *
 * Thin adapter over `ui/stat-tile.tsx`'s `StatTile` (Task 13): the animated number, entrance
 * reveal, and card chrome all come from there. This component's own props (`unit`, `hint`,
 * `loading`, `unfiltered`) have no equivalent on the generic tile, so they're composed back in
 * via its `children` slot instead of growing its prop surface. A pre-formatted/placeholder
 * `value` (e.g. "4m 5s", "—") isn't a number `AnimatedNumber` can tween, so that case renders a
 * plain, unanimated value with the same layout instead of forcing it through the ui tile.
 *
 * See `StatTile` for the lighter-weight variant (compact-formatted value, text-only delta, no
 * loading state) used where full precision and skeleton loading aren't needed.
 */
export function KpiTile({
  label,
  value,
  unit,
  hint,
  spark,
  delta,
  loading,
  unfiltered,
}: {
  label: string;
  /** A pre-formatted string, or a number rendered with full-precision grouping (1,284). */
  value: string | number;
  /** Optional unit suffix rendered beside the value (e.g. "ms"). */
  unit?: string;
  hint?: ReactNode;
  /** Sparkline series (oldest → newest); needs ≥ 2 points to draw. */
  spark?: number[];
  /** A period-over-period change; positive = up (▲ accent), negative = down (▼ danger). */
  delta?: { pct: number };
  /** Shows a Skeleton in place of the value/sparkline while data is in flight. */
  loading?: boolean;
  /**
   * feat-02 §3.4/T1: this tile is driven by an engagement/revenue metric endpoint that doesn't
   * accept the app-wide global filters yet (T2 follow-up). Pass only while a global filter is
   * active, so a small muted note appears — the UI must never imply a scope this number doesn't
   * actually honor.
   */
  unfiltered?: boolean;
}) {
  const hasSpark = !!spark && spark.length >= 2;
  const sparkline = hasSpark ? <Sparkline values={spark as number[]} stretch /> : undefined;

  if (loading) {
    return (
      <Reveal className="h-full">
        <Card
          interactive
          className={cn('relative flex h-full flex-col overflow-hidden p-6', hasSpark && 'pb-12')}
        >
          <span className={LABEL_CLASS}>{label}</span>
          <Skeleton data-testid="kpi-tile-skeleton" className="mt-2 h-8 w-20" />
          {/* Placed exactly where the real sparkline lands, so the tile doesn't reflow when the
              data arrives. */}
          {hasSpark && <Skeleton className="absolute inset-x-0 bottom-0 h-8 rounded-none" />}
        </Card>
      </Reveal>
    );
  }

  const extras = (
    <>
      {delta && <DeltaChip pct={delta.pct} />}
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
      {unfiltered && (
        <p className="mt-1 text-xs italic text-text-muted">Headline metrics aren&apos;t filtered yet</p>
      )}
    </>
  );

  if (typeof value === 'number') {
    return (
      <UiStatTile
        label={label}
        value={value}
        format={(n) => `${formatExactNumber(n)}${unit ? ` ${unit}` : ''}`}
        sparkline={sparkline}
      >
        {extras}
      </UiStatTile>
    );
  }

  return (
    <Reveal className="h-full">
      <Card
        interactive
        className={cn('relative flex h-full flex-col overflow-hidden p-6', sparkline && 'pb-12')}
      >
        <span className={LABEL_CLASS}>{label}</span>
        <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
          {value}
          {unit && <span className="ml-1 text-base font-normal text-text-muted">{unit}</span>}
        </p>
        {extras}
        {sparkline ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 opacity-40">{sparkline}</div>
        ) : null}
      </Card>
    </Reveal>
  );
}

/** Colour-blind-safe delta chip: colour is always paired with an arrow glyph, never used alone. */
function DeltaChip({ pct }: { pct: number }) {
  const isUp = pct >= 0;
  const rounded = Math.round(Math.abs(pct));
  return (
    <p
      className={`mt-2 text-xs font-medium tabular-nums ${isUp ? 'text-accent' : 'text-danger'}`}
    >
      <span aria-hidden="true">{isUp ? '▲' : '▼'} </span>
      {isUp ? '+' : '-'}
      {rounded}%
    </p>
  );
}
