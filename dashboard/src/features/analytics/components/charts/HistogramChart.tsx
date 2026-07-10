import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistogramBucket } from '../../../../lib/api/types';
import { colorForIndex } from '../../palette';
import { formatCurrency, formatDurationMs, formatExactNumber, formatPercent } from '../../format';
import { ChartTooltip, axisProps, useChartAnimationProps, gridProps } from './chart-theme';

/** How a bucket's `lower`/`upper` bounds (and the summary KPIs) should be formatted (feat-09 §3.2). */
export type HistogramUnit = 'number' | 'duration' | 'currency';

const CHART_MARGIN = { top: 8, right: 16, left: 0, bottom: 8 };

/** Formats a single bucket bound (or a summary KPI) by the metric's unit. */
export function formatHistogramValue(value: number, unit: HistogramUnit): string {
  switch (unit) {
    case 'duration':
      return formatDurationMs(value);
    case 'currency':
      return formatCurrency(value);
    default:
      return formatExactNumber(value);
  }
}

/** A compact `lower–upper` range label; collapses to a single value when the bucket has no width. */
function formatBucketRange(bucket: HistogramBucket, unit: HistogramUnit): string {
  if (bucket.lower === bucket.upper) return formatHistogramValue(bucket.lower, unit);
  return `${formatHistogramValue(bucket.lower, unit)}–${formatHistogramValue(bucket.upper, unit)}`;
}

interface HistogramRow {
  range: string;
  count: number;
}

/**
 * A histogram over `HistogramBucket[]` (feat-09 §3.2): one bar per adaptive-width bucket (x = a
 * compact `lower–upper` range label, y = count), a single palette color (one metric, not a
 * rainbow), reusing the `ChartCard`/dataviz conventions of `BreakdownChart`. Ships an accessible
 * data table (range, count, % of total) so the distribution's shape never rests on bar length
 * alone. `unit` formats both the bucket-range labels/tooltip and the table's range column.
 */
export function HistogramChart({
  buckets,
  ariaLabel,
  unit = 'number',
  height = 320,
}: {
  buckets: HistogramBucket[];
  ariaLabel: string;
  unit?: HistogramUnit;
  height?: number;
}) {
  const rows: HistogramRow[] = useMemo(
    () => buckets.map((bucket) => ({ range: formatBucketRange(bucket, unit), count: bucket.count })),
    [buckets, unit],
  );
  const total = useMemo(() => buckets.reduce((sum, bucket) => sum + bucket.count, 0), [buckets]);
  const animation = useChartAnimationProps();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="range" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip
              content={<ChartTooltip formatter={(value) => formatExactNumber(Number(value))} />}
              cursor={{ fill: 'var(--border)', opacity: 0.3 }}
            />
            <Bar dataKey="count" name="Count" {...animation} fill={colorForIndex(0)} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <HistogramTable rows={rows} total={total} ariaLabel={ariaLabel} />
    </div>
  );
}

function HistogramTable({
  rows,
  total,
  ariaLabel,
}: {
  rows: HistogramRow[];
  total: number;
  ariaLabel: string;
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{`${ariaLabel} data table`}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            Range
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Count
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            %
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.range}-${index}`} className="border-b border-border">
            <td className="py-2">{row.range}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(row.count)}</td>
            <td className="py-2 text-right tabular-nums">
              {total > 0 ? formatPercent(row.count / total) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
