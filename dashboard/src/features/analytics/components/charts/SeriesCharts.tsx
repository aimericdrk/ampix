import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartTooltip,
  SeriesGradient,
  axisProps,
  useChartAnimationProps,
  gridProps,
  seriesGradientId,
} from './chart-theme';

/**
 * Time-series chart primitives shared by the Insights chart-type picker and dashboards. Both take an
 * already-pivoted row set (one row per time bucket, one numeric column per series key) plus a stable
 * `colorFor(key)` so identity follows the entity, never its rank (dataviz). One Y axis only, a
 * recessive horizontal-only grid, a legend whenever there are ≥ 2 series, and a hover tooltip.
 */

export interface SeriesChartProps {
  rows: Array<Record<string, string | number>>;
  /** Series column keys, in fixed identity order. */
  keys: string[];
  /** Human labels per key (event · breakdown value). */
  labels: Map<string, string>;
  /** Fixed-order color per key — a `var(--series-N)` string. */
  colorFor: (key: string) => string;
  ariaLabel: string;
  height?: number;
}

/** Change-over-time as filled area. Multiple series stack (composition of the whole over time). */
export function AreaTrendChart({ rows, keys, labels, colorFor, ariaLabel, height = 320 }: SeriesChartProps) {
  const chartId = useId();
  const showLegend = keys.length > 1;
  const stacked = keys.length > 1;
  const animation = useChartAnimationProps();
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <defs>
            {keys.map((key, index) => (
              <SeriesGradient key={key} id={seriesGradientId(chartId, index)} color={colorFor(key)} />
            ))}
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="t" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip content={<ChartTooltip />} />
          {showLegend && <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />}
          {keys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={labels.get(key)}
              stackId={stacked ? 'stack' : undefined}
              stroke={colorFor(key)}
              strokeWidth={2}
              fill={`url(#${seriesGradientId(chartId, index)})`}
              fillOpacity={1}
              // A 2px surface line between stacked fills keeps segments separable (dataviz spacer).
              activeDot={{ r: 4, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
              {...animation}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Composition over time — one stacked bar per bucket, a 2px surface gap between segments. */
export function StackedBarChart({ rows, keys, labels, colorFor, ariaLabel, height = 320 }: SeriesChartProps) {
  const showLegend = keys.length > 1;
  const animation = useChartAnimationProps();
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="t" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--border)', opacity: 0.3 }} />
          {showLegend && <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />}
          {keys.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              name={labels.get(key)}
              stackId="stack"
              fill={colorFor(key)}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              maxBarSize={40}
              {...animation}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
