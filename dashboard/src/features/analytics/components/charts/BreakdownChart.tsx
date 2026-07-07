import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { colorForIndex } from '../../palette';
import { formatExactNumber } from '../../format';

/** A single label→value bar for the non-stacked variant. */
export interface BreakdownDatum {
  label: string;
  value: number;
}

/** One stacked segment (e.g. a user-type slice) within a stacked bar. */
export interface BreakdownSegment {
  key: string;
  value: number;
}

/** A single label's stacked bar, made of segments keyed the same way across every label. */
export interface StackedBreakdownDatum {
  label: string;
  segments: BreakdownSegment[];
}

export interface BreakdownChartProps {
  data: BreakdownDatum[] | StackedBreakdownDatum[];
  ariaLabel: string;
  /** Renders one stacked bar per label with a segment-key legend, instead of single bars. */
  stacked?: boolean;
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

const CHART_MARGIN = { top: 8, right: 48, left: 8, bottom: 8 };

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValueLabel(value: string | number | boolean | null | undefined): string {
  return typeof value === 'number' ? formatExactNumber(value) : String(value ?? '');
}

/**
 * "Metric by dimension" horizontal bars (OS, device, app version, network, UTM source, …).
 * Non-stacked: one bar per `label`, always re-sorted descending by value here — identity order is
 * never trusted from the caller, only the top-N slice is (dataviz: "sort by the metric that names
 * the chart"). Stacked: one bar per `label` split into named segments (e.g. new vs. returning),
 * with a segment-key legend and a running total label. Palette colors follow position, matching the
 * fixed-order rule used by `ComparisonTrend`/`CompositionPieChart`. Ships an accessible data table —
 * a plain column per value (or per segment key, plus a Total column when stacked) — so identity and
 * magnitude never rest on bar color/length alone.
 */
export function BreakdownChart({ data, ariaLabel, stacked = false, height = 320 }: BreakdownChartProps) {
  if (stacked) {
    return (
      <StackedBreakdownChart data={data as StackedBreakdownDatum[]} ariaLabel={ariaLabel} height={height} />
    );
  }
  return <SingleBreakdownChart data={data as BreakdownDatum[]} ariaLabel={ariaLabel} height={height} />;
}

function SingleBreakdownChart({
  data,
  ariaLabel,
  height,
}: {
  data: BreakdownDatum[];
  ariaLabel: string;
  height: number;
}) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.value - a.value), [data]);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="0" horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} stroke="var(--border)" />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} stroke="var(--border)" width={110} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--text-muted)' }}
              cursor={{ fill: 'var(--border)', opacity: 0.3 }}
              formatter={(value) => formatExactNumber(Number(value))}
            />
            <Bar dataKey="value" isAnimationActive={false} maxBarSize={28}>
              {sorted.map((item, index) => (
                <Cell key={item.label} fill={colorForIndex(index)} />
              ))}
              <LabelList dataKey="value" position="right" formatter={formatValueLabel} fill="var(--text)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <SingleBreakdownTable rows={sorted} />
    </div>
  );
}

function SingleBreakdownTable({ rows }: { rows: BreakdownDatum[] }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Breakdown data table</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            Label
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Value
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-border">
            <td className="py-2">{row.label}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StackedBreakdownChart({
  data,
  ariaLabel,
  height,
}: {
  data: StackedBreakdownDatum[];
  ariaLabel: string;
  height: number;
}) {
  const segmentKeys = useMemo(() => {
    const seen = new Set<string>();
    const keys: string[] = [];
    data.forEach((item) => {
      item.segments.forEach((segment) => {
        if (!seen.has(segment.key)) {
          seen.add(segment.key);
          keys.push(segment.key);
        }
      });
    });
    return keys;
  }, [data]);

  const rows = useMemo(
    () =>
      data.map((item) => {
        const row: Record<string, string | number> = { label: item.label };
        let total = 0;
        item.segments.forEach((segment) => {
          row[segment.key] = segment.value;
          total += segment.value;
        });
        row.total = total;
        return row;
      }),
    [data],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="0" horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} stroke="var(--border)" />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} stroke="var(--border)" width={110} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--text-muted)' }}
              cursor={{ fill: 'var(--border)', opacity: 0.3 }}
            />
            <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />
            {segmentKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                name={capitalize(key)}
                stackId="stack"
                fill={colorForIndex(index)}
                isAnimationActive={false}
              >
                {index === segmentKeys.length - 1 && (
                  <LabelList dataKey="total" position="right" formatter={formatValueLabel} fill="var(--text)" fontSize={12} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <StackedBreakdownTable data={data} segmentKeys={segmentKeys} />
    </div>
  );
}

function StackedBreakdownTable({
  data,
  segmentKeys,
}: {
  data: StackedBreakdownDatum[];
  segmentKeys: string[];
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Breakdown data table</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            Label
          </th>
          {segmentKeys.map((key) => (
            <th key={key} scope="col" className="py-2 text-right font-medium">
              {capitalize(key)}
            </th>
          ))}
          <th scope="col" className="py-2 text-right font-medium">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const valueByKey = new Map(row.segments.map((segment) => [segment.key, segment.value]));
          const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
          return (
            <tr key={row.label} className="border-b border-border">
              <td className="py-2">{row.label}</td>
              {segmentKeys.map((key) => {
                const value = valueByKey.get(key);
                return (
                  <td key={key} className="py-2 text-right tabular-nums">
                    {value === undefined ? '—' : formatExactNumber(value)}
                  </td>
                );
              })}
              <td className="py-2 text-right tabular-nums font-medium">{formatExactNumber(total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
