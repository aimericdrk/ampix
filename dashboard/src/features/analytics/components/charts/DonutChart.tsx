import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatExactNumber, formatPercent } from '../../format';
import { CompositionLegend, type PieSlice } from './CompositionPieChart';

/**
 * Thin-ring donut variant of `CompositionPieChart` for compositions that also want a headline
 * total sitting in the hole (dataviz "identity + share + the answer"). Same fixed-order slice
 * colors and the same accessible legend/table (`CompositionLegend`, reused verbatim) — only the
 * ring geometry and the optional center overlay differ.
 */
export function DonutChart({
  slices,
  colorFor,
  ariaLabel,
  centerLabel,
  centerValue,
  height = 260,
}: {
  slices: PieSlice[];
  colorFor: (key: string) => string;
  ariaLabel: string;
  /** Small caption under the center total (e.g. "Total sessions"). Ignored if `centerValue` is unset. */
  centerLabel?: string;
  /** A pre-formatted string, or a number that gets exact-formatted (1,284). Omit to hide the overlay. */
  centerValue?: string | number;
  height?: number;
}) {
  const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);

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
              contentStyle={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                fontSize: 13,
              }}
              formatter={(value, name) => {
                const n = Number(value);
                return [
                  `${formatExactNumber(n)} (${total > 0 ? formatPercent(n / total) : '0%'})`,
                  name,
                ];
              }}
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="70%"
              outerRadius="90%"
              paddingAngle={1}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={colorFor(slice.key)} />
              ))}
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

      <CompositionLegend slices={slices} colorFor={colorFor} total={total} />
    </div>
  );
}
