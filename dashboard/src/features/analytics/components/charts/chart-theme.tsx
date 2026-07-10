import type { ReactNode } from 'react';
import { useMotionSafe } from '../../../../lib/motion';

/**
 * Shared Recharts theming for the "MyAmpix Neon" chart kit: a glass tooltip, gradient area
 * under-fills, a quiet dashed grid, muted line-free ticks, and a reduced-motion-aware draw-in
 * animation. Every chart in this directory composes these instead of re-declaring its own tooltip
 * markup / grid+axis props / animation flags, so a future restyle only touches this file.
 *
 * HARD CONSTRAINT (dataviz): nothing here recolors data encodings — series colors stay
 * `var(--series-1..8)`/`var(--series-other)`, chosen by the caller and passed straight through
 * (`entry.color`, `colorFor(key)`, …). This file only supplies chrome around the marks: the
 * tooltip shell, grid/axis chrome, gradients keyed to whatever color the caller already picked,
 * and animation timing.
 */

/** The subset of a Recharts tooltip payload entry `ChartTooltip` renders. */
export interface ChartTooltipEntry {
  value?: unknown;
  name?: unknown;
  color?: string;
  fill?: string;
  dataKey?: string | number;
  payload?: unknown;
}

/** Matches Recharts' `Tooltip formatter` signature: return a node, or `[value, name]` to override both. */
export type ChartTooltipFormatter = (
  value: unknown,
  name: unknown,
  entry: ChartTooltipEntry,
  index: number,
  payload: readonly ChartTooltipEntry[],
) => ReactNode | [ReactNode, ReactNode];

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly ChartTooltipEntry[];
  /** Per-item value/name formatter — pass the same logic the chart's old `<Tooltip formatter>` used. */
  formatter?: ChartTooltipFormatter;
  /** Formats the header row (the x-axis bucket); omit to show `label` as-is. */
  labelFormatter?: (label: string | number) => ReactNode;
}

/**
 * The shared glass tooltip `content` for every chart's `<Tooltip>`: a blurred, bordered card with
 * one row per series — a `size-2` dot in the series' own color, its name, and its (optionally
 * `formatter`-ed) value in tabular figures. Recharts clones whatever element is passed as
 * `content`, merging in `active`/`payload`/`label` — so `<Tooltip content={<ChartTooltip
 * formatter={...} />} />` is all a chart needs to opt in, exactly like the `formatter` it used to
 * pass straight to `<Tooltip>`.
 */
export function ChartTooltip({ active, label, payload, formatter, labelFormatter }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-raised/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      {label !== undefined && (
        <p className="mb-1 whitespace-nowrap text-text-muted">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((entry, index) => {
          const color = entry.color ?? entry.fill ?? 'var(--text-muted)';
          let value: ReactNode = entry.value as ReactNode;
          let name: ReactNode = entry.name as ReactNode;
          if (formatter) {
            const formatted = formatter(entry.value, entry.name, entry, index, payload);
            if (Array.isArray(formatted)) {
              [value, name] = formatted;
            } else {
              value = formatted;
            }
          }
          return (
            <div key={String(entry.dataKey ?? entry.name ?? index)} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-text-muted">{name}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums text-text">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A vertical fade-to-transparent def for an `Area`'s `fill` — the series' own color at 35%
 * opacity at the top, fading to fully transparent at the baseline (dataviz "under-fill", never a
 * second hue). Render inside a `<defs>` and reference via `fill={`url(#${id})`}`; `id` must be
 * unique per rendered chart instance (see `seriesGradientId`) since a chart can appear twice on
 * one page.
 */
export function SeriesGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/** A collision-safe gradient id for the Nth series of one chart instance — derive `chartId` from `useId()`. */
export function seriesGradientId(chartId: string, seriesIndex: number): string {
  return `chart-gradient-${chartId}-${seriesIndex}`;
}

/**
 * Quiet, recessive grid: a dashed rule, off by default on the axis that plots categories (time
 * flows left-to-right; only the value axis needs a rule). Spread first, then override
 * `vertical`/`horizontal` for chart layouts that plot categories on the y-axis instead (e.g.
 * horizontal bars), so chart-specific orientation always wins.
 */
export const gridProps = {
  stroke: 'var(--border)',
  strokeDasharray: '3 6',
  vertical: false,
} as const;

/**
 * Muted, line-free ticks — the axis reads as labels floating over the grid, not a ruled box.
 * Spread first so chart-specific props (`dataKey`, `type`, `domain`, `tickFormatter`, `width`, …)
 * layer on top undisturbed.
 */
export const axisProps = {
  tick: { fill: 'var(--text-muted)', fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

/** Draw-in on load/update. */
export const animationProps = {
  isAnimationActive: true,
  animationDuration: 600,
  animationEasing: 'ease-out',
} as const;

/** No motion — used instead of `animationProps` when the user prefers reduced motion. */
export const noAnimation = {
  isAnimationActive: false,
} as const;

/**
 * `animationProps` or `noAnimation`, chosen reactively — the one-liner every chart spreads onto
 * its marks. Built on `useMotionSafe` (`lib/motion.ts`), the reactive sibling of
 * `useReducedMotion`, so a live OS reduced-motion toggle re-renders charts just like every other
 * animated surface (see that hook's comment for why it queries the affirmative `no-preference`
 * form — the jsdom stub must resolve to "no motion" or animated Recharts marks render nothing in
 * tests).
 */
export function useChartAnimationProps(): typeof animationProps | typeof noAnimation {
  return useMotionSafe() ? animationProps : noAnimation;
}
