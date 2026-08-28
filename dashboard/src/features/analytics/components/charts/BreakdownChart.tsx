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
import { ChartTooltip, axisProps, useChartAnimationProps, gridProps } from './chart-theme';
import { CollapsibleTable } from '../../../../components/ui/CollapsibleTable';

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

/**
 * `stacked` and `data` are tied together in a discriminated union so passing single-shape rows
 * with `stacked` (or segmented rows without it) fails to compile instead of crashing at render —
 * see `breakdown-chart.test.tsx` for a `// @ts-expect-error` guard on the mismatched combination.
 */
export type BreakdownChartProps = {
  ariaLabel: string;
  height?: number;
  /**
   * When provided, every bar (and its accessible-table label cell) becomes an activatable
   * "drill into this value" control (feat-03 §3.1): bars get `cursor-pointer` + a hover emphasis
   * and call `onSelectValue(label)` on click; the table's label cell becomes a `<button>` so
   * keyboard/screen-reader users can drill too. Synthetic rollup buckets (label `$other`/`Other`)
   * are never selectable. Omit entirely for the original, fully non-interactive chart.
   */
  onSelectValue?: (label: string) => void;
  /** Marks the currently-active drill-down value (if any) with a selected treatment. */
  selectedValue?: string;
} & (
  | {
      /** Renders one stacked bar per label with a segment-key legend, instead of single bars. */
      stacked?: false;
      data: BreakdownDatum[];
    }
  | {
      stacked: true;
      data: StackedBreakdownDatum[];
    }
);

const CHART_MARGIN = { top: 8, right: 48, left: 8, bottom: 8 };

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValueLabel(value: string | number | boolean | null | undefined): string {
  return typeof value === 'number' ? formatExactNumber(value) : String(value ?? '');
}

/** Synthetic top-N rollup buckets (feat-03 §4) — never selectable, no matter which chart renders them. */
function isSyntheticLabel(label: string): boolean {
  return label === '$other' || label === 'Other';
}

/** Whether a given row's label is currently drillable, and whether it's the active selection. */
function selectableCellState(
  label: string,
  onSelectValue: ((label: string) => void) | undefined,
  selectedValue: string | undefined,
): { selectable: boolean; isSelected: boolean } {
  const selectable = Boolean(onSelectValue) && !isSyntheticLabel(label);
  return { selectable, isSelected: selectable && selectedValue === label };
}

const SELECTABLE_MARK_CLASS = 'cursor-pointer motion-safe:transition-opacity hover:opacity-75';
const SELECTABLE_LABEL_CLASS =
  'text-left underline-offset-2 motion-safe:transition-colors hover:underline focus-visible:underline';

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
export function BreakdownChart(props: BreakdownChartProps) {
  const { ariaLabel, height = 320, onSelectValue, selectedValue } = props;
  if (props.stacked) {
    return (
      <StackedBreakdownChart
        data={props.data}
        ariaLabel={ariaLabel}
        height={height}
        onSelectValue={onSelectValue}
        selectedValue={selectedValue}
      />
    );
  }
  return (
    <SingleBreakdownChart
      data={props.data}
      ariaLabel={ariaLabel}
      height={height}
      onSelectValue={onSelectValue}
      selectedValue={selectedValue}
    />
  );
}

function SingleBreakdownChart({
  data,
  ariaLabel,
  height,
  onSelectValue,
  selectedValue,
}: {
  data: BreakdownDatum[];
  ariaLabel: string;
  height: number;
  onSelectValue?: (label: string) => void;
  selectedValue?: string;
}) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.value - a.value), [data]);
  const animation = useChartAnimationProps();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} vertical horizontal={false} />
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey="label" {...axisProps} width={110} />
            <Tooltip
              content={<ChartTooltip formatter={(value) => formatExactNumber(Number(value))} />}
              cursor={{ fill: 'var(--border)', opacity: 0.3 }}
            />
            <Bar dataKey="value" {...animation} maxBarSize={28} fill={colorForIndex(0)}>
              {onSelectValue &&
                sorted.map((row) => {
                  const { selectable, isSelected } = selectableCellState(
                    row.label,
                    onSelectValue,
                    selectedValue,
                  );
                  return (
                    <Cell
                      key={row.label}
                      fill={colorForIndex(0)}
                      stroke={isSelected ? 'var(--text)' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                      className={selectable ? SELECTABLE_MARK_CLASS : undefined}
                      onClick={selectable ? () => onSelectValue(row.label) : undefined}
                    />
                  );
                })}
              <LabelList dataKey="value" position="right" formatter={formatValueLabel} fill="var(--text)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <SingleBreakdownTable
        rows={sorted}
        ariaLabel={ariaLabel}
        onSelectValue={onSelectValue}
        selectedValue={selectedValue}
      />
    </div>
  );
}

function SingleBreakdownTable({
  rows,
  ariaLabel,
  onSelectValue,
  selectedValue,
}: {
  rows: BreakdownDatum[];
  ariaLabel: string;
  onSelectValue?: (label: string) => void;
  selectedValue?: string;
}) {
  return (
    <CollapsibleTable count={rows.length}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{`${ariaLabel} data table`}</caption>
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
          {rows.map((row) => {
            const { selectable, isSelected } = selectableCellState(row.label, onSelectValue, selectedValue);
            return (
              <tr key={row.label} className="border-b border-border">
                <td className="py-2">
                  {selectable ? (
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelectValue!(row.label)}
                      className={SELECTABLE_LABEL_CLASS}
                    >
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{formatExactNumber(row.value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CollapsibleTable>
  );
}

function StackedBreakdownChart({
  data,
  ariaLabel,
  height,
  onSelectValue,
  selectedValue,
}: {
  data: StackedBreakdownDatum[];
  ariaLabel: string;
  height: number;
  onSelectValue?: (label: string) => void;
  selectedValue?: string;
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
  const animation = useChartAnimationProps();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} vertical horizontal={false} />
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey="label" {...axisProps} width={110} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--border)', opacity: 0.3 }} />
            <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />
            {segmentKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                name={capitalize(key)}
                stackId="stack"
                fill={colorForIndex(index)}
                {...animation}
              >
                {onSelectValue &&
                  rows.map((row) => {
                    const label = String(row.label);
                    const { selectable, isSelected } = selectableCellState(
                      label,
                      onSelectValue,
                      selectedValue,
                    );
                    return (
                      <Cell
                        key={label}
                        fill={colorForIndex(index)}
                        stroke={isSelected ? 'var(--text)' : 'none'}
                        strokeWidth={isSelected ? 2 : 0}
                        className={selectable ? SELECTABLE_MARK_CLASS : undefined}
                        onClick={selectable ? () => onSelectValue(label) : undefined}
                      />
                    );
                  })}
                {index === segmentKeys.length - 1 && (
                  <LabelList dataKey="total" position="right" formatter={formatValueLabel} fill="var(--text)" fontSize={12} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <StackedBreakdownTable
        data={data}
        segmentKeys={segmentKeys}
        ariaLabel={ariaLabel}
        onSelectValue={onSelectValue}
        selectedValue={selectedValue}
      />
    </div>
  );
}

function StackedBreakdownTable({
  data,
  segmentKeys,
  ariaLabel,
  onSelectValue,
  selectedValue,
}: {
  data: StackedBreakdownDatum[];
  segmentKeys: string[];
  ariaLabel: string;
  onSelectValue?: (label: string) => void;
  selectedValue?: string;
}) {
  return (
    <CollapsibleTable count={data.length}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{`${ariaLabel} data table`}</caption>
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
            const { selectable, isSelected } = selectableCellState(row.label, onSelectValue, selectedValue);
            return (
              <tr key={row.label} className="border-b border-border">
                <td className="py-2">
                  {selectable ? (
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelectValue!(row.label)}
                      className={SELECTABLE_LABEL_CLASS}
                    >
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )}
                </td>
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
    </CollapsibleTable>
  );
}
