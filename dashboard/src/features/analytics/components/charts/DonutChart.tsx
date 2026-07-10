import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatExactNumber, formatPercent } from '../../format';
import type { PieSlice } from './CompositionPieChart';
import { ChartTooltip, useChartAnimationProps } from './chart-theme';

/** Synthetic top-N rollup buckets (feat-03 §4) — never selectable. */
function isSyntheticLabel(label: string): boolean {
  return label === '$other' || label === 'Other';
}

const SELECTABLE_MARK_CLASS = 'cursor-pointer motion-safe:transition-opacity hover:opacity-75';
const SELECTABLE_LABEL_CLASS =
  'flex-1 truncate text-left underline-offset-2 motion-safe:transition-colors hover:underline focus-visible:underline';

/**
 * Thin-ring donut variant of `CompositionPieChart` for compositions that also want a headline
 * total sitting in the hole (dataviz "identity + share + the answer"). Same fixed-order slice
 * colors and the same accessible legend/table shape as `CompositionPieChart`'s `CompositionLegend`
 * — rendered locally (`DonutLegend` below) so its label cell can become an activatable drill-down
 * control without changing the shared component. Only the ring geometry and the optional center
 * overlay differ from the plain pie.
 */
export function DonutChart({
  slices,
  colorFor,
  ariaLabel,
  centerLabel,
  centerValue,
  height = 260,
  legendLabel = 'Composition legend (donut)',
  onSelectValue,
  selectedValue,
}: {
  slices: PieSlice[];
  colorFor: (key: string) => string;
  ariaLabel: string;
  /** Small caption under the center total (e.g. "Total sessions"). Ignored if `centerValue` is unset. */
  centerLabel?: string;
  /** A pre-formatted string, or a number that gets exact-formatted (1,284). Omit to hide the overlay. */
  centerValue?: string | number;
  height?: number;
  /** Legend `aria-label`; defaults to a donut-specific name so a page with both a pie and a donut never exposes two identically-named lists. */
  legendLabel?: string;
  /**
   * When provided, every slice (and its legend label) becomes an activatable "drill into this
   * value" control (feat-03 §3.1): slices get `cursor-pointer` + a hover emphasis and call
   * `onSelectValue(label)` on click; the legend label becomes a `<button>` so keyboard/screen-
   * reader users can drill too. Synthetic rollup buckets (label `$other`/`Other`) are never
   * selectable. Omit entirely for the original, fully non-interactive chart.
   */
  onSelectValue?: (label: string) => void;
  /** Marks the currently-active drill-down value (if any) with a selected treatment. */
  selectedValue?: string;
}) {
  const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);
  const animation = useChartAnimationProps();

  const centerDisplay =
    centerValue === undefined
      ? undefined
      : typeof centerValue === 'number'
        ? formatExactNumber(centerValue)
        : centerValue;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 280,
          height,
          backgroundColor: 'var(--chart-surface)',
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={
                <ChartTooltip
                  formatter={(value, name) => {
                    const n = Number(value);
                    return [
                      `${formatExactNumber(n)} (${total > 0 ? formatPercent(n / total) : '0%'})`,
                      name as string,
                    ];
                  }}
                />
              }
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="70%"
              outerRadius="90%"
              paddingAngle={1}
              stroke="var(--surface)"
              strokeWidth={2}
              {...animation}
            >
              {slices.map((slice) => {
                const selectable = Boolean(onSelectValue) && !isSyntheticLabel(slice.label);
                const isSelected = selectable && selectedValue === slice.label;
                return (
                  <Cell
                    key={slice.key}
                    fill={colorFor(slice.key)}
                    stroke={isSelected ? 'var(--text)' : 'var(--surface)'}
                    strokeWidth={isSelected ? 3 : 2}
                    className={selectable ? SELECTABLE_MARK_CLASS : undefined}
                    onClick={selectable ? () => onSelectValue!(slice.label) : undefined}
                  />
                );
              })}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {centerDisplay !== undefined && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span className="text-xl font-semibold tabular-nums text-text">{centerDisplay}</span>
            {centerLabel && <span className="text-xs text-text-muted">{centerLabel}</span>}
          </div>
        )}
      </div>

      <DonutLegend
        slices={slices}
        colorFor={colorFor}
        total={total}
        legendLabel={legendLabel}
        onSelectValue={onSelectValue}
        selectedValue={selectedValue}
      />
    </div>
  );
}

/**
 * The donut's accessible label+value(+percent) legend — the same markup as
 * `CompositionPieChart`'s shared `CompositionLegend`, kept local to this file so its label can
 * become an activatable `<button>` when `onSelectValue` is provided, without changing the shared
 * component's (non-selectable) contract used elsewhere.
 */
function DonutLegend({
  slices,
  colorFor,
  total,
  legendLabel,
  onSelectValue,
  selectedValue,
}: {
  slices: PieSlice[];
  colorFor: (key: string) => string;
  total: number;
  legendLabel: string;
  onSelectValue?: (label: string) => void;
  selectedValue?: string;
}) {
  return (
    <ul aria-label={legendLabel} className="flex flex-1 flex-col gap-1.5 text-sm">
      {slices.map((slice) => {
        const selectable = Boolean(onSelectValue) && !isSyntheticLabel(slice.label);
        const isSelected = selectable && selectedValue === slice.label;
        return (
          <li key={slice.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: colorFor(slice.key) }}
            />
            {selectable ? (
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectValue!(slice.label)}
                className={SELECTABLE_LABEL_CLASS}
              >
                {slice.label}
              </button>
            ) : (
              <span className="flex-1 truncate">{slice.label}</span>
            )}
            <span className="tabular-nums text-text-muted">
              <span className="font-medium text-text">{formatExactNumber(slice.value)}</span>{' '}
              <span>{total > 0 ? formatPercent(slice.value / total) : '0%'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
