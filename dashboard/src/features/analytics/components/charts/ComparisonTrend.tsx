import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { colorForIndex, SERIES_OTHER_COLOR_VAR } from '../../palette';
import { formatExactNumber } from '../../format';

export interface ComparisonTrendPoint {
  [key: string]: string | number;
}

export interface ComparisonTrendProps {
  /** Current-period rows, oldest → newest. */
  current: ComparisonTrendPoint[];
  /** Previous-period rows, aligned to `current` by index (not by matching `xKey` values). */
  previous?: ComparisonTrendPoint[];
  /** Column holding the x-axis bucket (e.g. a date string). */
  xKey: string;
  /** Column holding the numeric value to plot. */
  valueKey: string;
  /** Human label for the plotted metric — doubles as the "current" table column header. */
  label: string;
  ariaLabel: string;
  height?: number;
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
};

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A time-trend line/area with an optional dashed, muted "previous period" overlay (dataviz
 * period-over-period comparison). `previous` aligns to `current` by array index — the two periods
 * rarely share x-axis labels (e.g. "Jun 29" vs "May 30"), so the x-axis always follows `current`.
 * Current is the solid, primary-color area (fixed index 0); previous is a dashed `--series-other`
 * line, never filled, so it always reads as the recessive comparison. Ships an accessible data
 * table underneath, mirroring `SeriesCharts`/`InsightsChart` (identity + magnitude never rest on
 * color alone).
 */
export function ComparisonTrend({
  current,
  previous,
  xKey,
  valueKey,
  label,
  ariaLabel,
  height = 320,
}: ComparisonTrendProps) {
  const hasPrevious = !!previous && previous.length > 0;
  const currentColor = colorForIndex(0);

  const rows = current.map((row, index) => ({
    x: row[xKey],
    current: row[valueKey],
    previous: hasPrevious ? previous![index]?.[valueKey] : undefined,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
            <XAxis dataKey="x" tick={AXIS_TICK} stroke="var(--border)" />
            <YAxis tick={AXIS_TICK} stroke="var(--border)" />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-muted)' }} />
            {hasPrevious && <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />}
            <Area
              type="monotone"
              dataKey="current"
              name="Current"
              stroke={currentColor}
              strokeWidth={2}
              fill={currentColor}
              fillOpacity={0.18}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
            />
            {hasPrevious && (
              <Line
                type="monotone"
                dataKey="previous"
                name="Previous"
                stroke={SERIES_OTHER_COLOR_VAR}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ComparisonTrendTable
        rows={rows}
        xHeader={capitalize(xKey)}
        valueHeader={label}
        hasPrevious={hasPrevious}
      />
    </div>
  );
}

interface ComparisonRow {
  x: string | number | undefined;
  current: string | number | undefined;
  previous?: string | number;
}

function formatCell(value: string | number | undefined): string {
  if (value === undefined) return '—';
  return typeof value === 'number' ? formatExactNumber(value) : value;
}

function ComparisonTrendTable({
  rows,
  xHeader,
  valueHeader,
  hasPrevious,
}: {
  rows: ComparisonRow[];
  xHeader: string;
  valueHeader: string;
  hasPrevious: boolean;
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{`${valueHeader} trend data table`}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            {xHeader}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {valueHeader}
          </th>
          {hasPrevious && (
            <th scope="col" className="py-2 text-right font-medium">
              Previous
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${String(row.x)}-${index}`} className="border-b border-border">
            <td className="py-2">{formatCell(row.x)}</td>
            <td className="py-2 text-right tabular-nums">{formatCell(row.current)}</td>
            {hasPrevious && (
              <td className="py-2 text-right tabular-nums">{formatCell(row.previous)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
