import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Segmented } from '../../../components/ui/segmented';
import { CollapsibleTable } from '../../../components/ui/CollapsibleTable';
import { formatCompactNumber, formatExactNumber } from '../format';
import { assignSeriesColors, seriesKey, seriesLabel } from '../palette';
import type { InsightsSeries } from '../../../lib/api/types';
import { ChartTooltip, axisProps, gridProps, useChartAnimationProps } from './charts/chart-theme';
import { AreaTrendChart, StackedBarChart } from './charts/SeriesCharts';
import { CompositionPieChart, type PieSlice } from './charts/CompositionPieChart';

export type InsightsChartType = 'line' | 'bar' | 'area' | 'stacked' | 'pie' | 'number' | 'table';

export const INSIGHTS_CHART_TYPES: { value: InsightsChartType; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'area', label: 'Area' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'pie', label: 'Pie' },
  { value: 'number', label: 'Number' },
  { value: 'table', label: 'Table' },
];

interface PivotRow {
  t: string;
  [seriesKey: string]: string | number;
}

function pivot(series: InsightsSeries[]): {
  rows: PivotRow[];
  keys: string[];
  labels: Map<string, string>;
} {
  const keys: string[] = [];
  const labels = new Map<string, string>();
  for (const s of series) {
    const key = seriesKey(s.name, s.breakdown_value);
    if (!labels.has(key)) {
      keys.push(key);
      labels.set(key, seriesLabel(s.name, s.breakdown_value));
    }
  }

  const tValues = Array.from(new Set(series.flatMap((s) => s.data.map((p) => p.t)))).sort();
  const rows: PivotRow[] = tValues.map((t) => {
    const row: PivotRow = { t };
    for (const s of series) {
      const key = seriesKey(s.name, s.breakdown_value);
      const point = s.data.find((p) => p.t === t);
      row[key] = point ? point.value : 0;
    }
    return row;
  });

  return { rows, keys, labels };
}

/**
 * Renders an insights result set with a chart-type picker (line · bar · area · stacked · pie ·
 * number · table) over the primary visualization, plus a raw data table underneath — collapsed by
 * default (it is the same numbers the chart already draws), except when `table` IS the chart type.
 * Per the dataviz spec, identity is never carried by color alone: the table (and, for 2+ series, the
 * legend) stays reachable regardless of which chart is selected, and colors are assigned by series
 * identity in fixed order (never repainted when a series drops out). The picker is controlled by the
 * page so the choice persists in the builder state.
 */
export function InsightsChart({
  series,
  eventOrder,
  chartType: controlledType,
  onChartTypeChange,
}: {
  series: InsightsSeries[];
  /** The order events were added in the builder — colors key off this, not the response's array
   * order, so a filter that drops a series never repaints the survivors. */
  eventOrder: string[];
  /** Controlled selection (persisted in the page's builder state). Omit to run uncontrolled. */
  chartType?: InsightsChartType;
  onChartTypeChange?: (next: InsightsChartType) => void;
}) {
  const [internalType, setInternalType] = useState<InsightsChartType>('line');
  const chartType = controlledType ?? internalType;
  const setChartType = onChartTypeChange ?? setInternalType;
  const colors = useMemo(() => assignSeriesColors(series, eventOrder), [series, eventOrder]);
  const { rows, keys, labels } = useMemo(() => pivot(series), [series]);
  const showLegend = keys.length > 1;
  const colorFor = (key: string) => colors.get(key) ?? 'var(--series-1)';
  const animation = useChartAnimationProps();

  const pieSlices: PieSlice[] = useMemo(
    () =>
      keys.map((key) => ({
        key,
        label: labels.get(key) ?? key,
        value: rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0),
      })),
    [keys, labels, rows],
  );

  return (
    <div className="flex flex-col gap-6">
      <Segmented
        aria-label="Chart type"
        className="flex-wrap"
        options={INSIGHTS_CHART_TYPES}
        value={chartType}
        onValueChange={(next) => setChartType(next as InsightsChartType)}
      />

      {(chartType === 'line' || chartType === 'bar') && (
        <div
          aria-label={`Insights ${chartType} chart`}
          role="img"
          style={{ width: '100%', height: 320, backgroundColor: 'var(--chart-surface)' }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'line' ? (
              <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip content={<ChartTooltip />} />
                {showLegend && <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />}
                {keys.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={labels.get(key)}
                    stroke={colorFor(key)}
                    strokeWidth={2}
                    dot={{
                      r: 4,
                      fill: colorFor(key),
                      stroke: 'var(--chart-surface)',
                      strokeWidth: 2,
                    }}
                    {...animation}
                  />
                ))}
              </LineChart>
            ) : (
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
                    fill={colorFor(key)}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={24}
                    {...animation}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {chartType === 'area' && (
        <AreaTrendChart rows={rows} keys={keys} labels={labels} colorFor={colorFor} ariaLabel="Insights area chart" />
      )}

      {chartType === 'stacked' && (
        <StackedBarChart
          rows={rows}
          keys={keys}
          labels={labels}
          colorFor={colorFor}
          ariaLabel="Insights stacked bar chart"
        />
      )}

      {chartType === 'pie' && (
        <CompositionPieChart slices={pieSlices} colorFor={colorFor} ariaLabel="Insights pie chart" />
      )}

      {chartType === 'number' && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {keys.map((key) => {
            const total = rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
            return (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-text-muted">
                    {labels.get(key)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold">{formatCompactNumber(total)}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {chartType === 'table' ? (
        <RawDataTable series={series} />
      ) : (
        <CollapsibleTable count={series.reduce((total, s) => total + s.data.length, 0)}>
          <RawDataTable series={series} />
        </CollapsibleTable>
      )}
    </div>
  );
}

function RawDataTable({ series }: { series: InsightsSeries[] }) {
  const hasBreakdown = series.some((s) => s.breakdown_value !== null);
  const rows = series.flatMap((s) =>
    s.data.map((point) => ({
      event: s.name,
      breakdown_value: s.breakdown_value,
      t: point.t,
      value: point.value,
    })),
  );

  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Insights data table</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            Event
          </th>
          {hasBreakdown && (
            <th scope="col" className="py-2 font-medium">
              Breakdown
            </th>
          )}
          <th scope="col" className="py-2 font-medium">
            Date
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Value
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={`${row.event}-${row.breakdown_value ?? ''}-${row.t}-${index}`}
            className="border-b border-border"
          >
            <td className="py-2">{row.event}</td>
            {hasBreakdown && <td className="py-2">{row.breakdown_value ?? '—'}</td>}
            <td className="py-2">{row.t}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
