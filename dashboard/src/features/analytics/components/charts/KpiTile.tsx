import { type ReactNode } from 'react';
import { Card } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { formatExactNumber } from '../../format';
import { Sparkline } from './sparkline';

/**
 * The headline KPI primitive for Phase 1 pages: a big, full-precision number, an optional
 * sparkline for magnitude-over-time context, and a period-over-period delta chip. The delta
 * always pairs an arrow glyph with its colour (▲ accent / ▼ danger) so meaning survives
 * grayscale/CVD viewing. `loading` swaps the value and sparkline for `Skeleton` placeholders.
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
  const display = typeof value === 'number' ? formatExactNumber(value) : value;
  const hasSpark = !!spark && spark.length >= 2;

  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-text-muted">{label}</p>
      {loading ? (
        <div className="mt-2 flex items-end justify-between gap-3">
          <Skeleton data-testid="kpi-tile-skeleton" className="h-8 w-20" />
          {hasSpark && <Skeleton className="h-8 w-24" />}
        </div>
      ) : (
        <div className="mt-1 flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tabular-nums leading-none">
            {display}
            {unit && <span className="ml-1 text-base font-normal text-text-muted">{unit}</span>}
          </p>
          {hasSpark && <Sparkline values={spark as number[]} />}
        </div>
      )}
      {!loading && delta && <DeltaChip pct={delta.pct} />}
      {!loading && hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
      {!loading && unfiltered && (
        <p className="mt-1 text-xs italic text-text-muted">Headline metrics aren&apos;t filtered yet</p>
      )}
    </Card>
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
