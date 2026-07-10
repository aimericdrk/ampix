import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatExactNumber, formatPercent } from '../../format';
import { ChartTooltip, useChartAnimationProps } from './chart-theme';

export interface PieSlice {
  key: string;
  label: string;
  value: number;
}

/**
 * Composition of a whole (dataviz "identity + share"). A donut by default so the total can sit in
 * the hole. Colors follow slice identity in the caller's fixed order (never rank). Every slice is
 * also listed in an adjacent legend with its exact value AND percent, so identity/magnitude never
 * rest on color alone — that legend doubles as the accessible table. A 2px surface ring separates
 * neighbouring wedges.
 */
export function CompositionPieChart({
  slices,
  colorFor,
  ariaLabel,
  donut = true,
  height = 260,
  legendLabel = 'Composition legend',
}: {
  slices: PieSlice[];
  colorFor: (key: string) => string;
  ariaLabel: string;
  donut?: boolean;
  height?: number;
  /** Legend `aria-label`; override when a page renders more than one composition legend so each has a unique accessible name. */
  legendLabel?: string;
}) {
  const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);
  const animation = useChartAnimationProps();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', maxWidth: 280, height, backgroundColor: 'var(--chart-surface)' }}
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
              innerRadius={donut ? '55%' : 0}
              outerRadius="90%"
              paddingAngle={1}
              stroke="var(--surface)"
              strokeWidth={2}
              {...animation}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={colorFor(slice.key)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <CompositionLegend slices={slices} colorFor={colorFor} total={total} legendLabel={legendLabel} />
    </div>
  );
}

/**
 * The accessible label+value(+percent) listing shared by every composition chart
 * (`CompositionPieChart`, `DonutChart`) — the text alternative that keeps identity/magnitude off
 * color alone. Exported so donut-style variants can reuse it verbatim instead of duplicating markup.
 * `legendLabel` should be unique per page when a pie and a donut render side by side, so their
 * legends don't expose two identically-named lists to assistive tech.
 */
export function CompositionLegend({
  slices,
  colorFor,
  total,
  legendLabel = 'Composition legend',
}: {
  slices: PieSlice[];
  colorFor: (key: string) => string;
  total: number;
  legendLabel?: string;
}) {
  return (
    <ul aria-label={legendLabel} className="flex flex-1 flex-col gap-1.5 text-sm">
      {slices.map((slice) => (
        <li key={slice.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: colorFor(slice.key) }}
          />
          <span className="flex-1 truncate">{slice.label}</span>
          <span className="tabular-nums text-text-muted">
            <span className="font-medium text-text">{formatExactNumber(slice.value)}</span>{' '}
            <span>{total > 0 ? formatPercent(slice.value / total) : '0%'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
