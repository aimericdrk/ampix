import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Anomaly } from '../../anomaly';
import type { Annotation } from '../../annotations';
import { colorForIndex, SERIES_OTHER_COLOR_VAR } from '../../palette';
import { formatExactNumber } from '../../format';
import {
  ChartTooltip,
  SeriesGradient,
  axisProps,
  chartAnimationProps,
  gridProps,
  seriesGradientId,
} from './chart-theme';

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
  /** Points flagged by `detectAnomalies` (feat-07) — renders a ringed, shaped marker at each
   * anomalous index plus a "△ anomaly" legend note. Omit (or pass an empty array) to keep the
   * chart exactly as before — fully backward compatible. */
  anomalies?: Anomaly[];
  /** Release markers / notes (feat-08) — renders a muted, dashed vertical `ReferenceLine` for
   * each annotation whose `date` matches one of the chart's own x-axis bucket values (`xKey`);
   * an annotation outside this chart's range is simply skipped here (still stored/listed
   * elsewhere). Omit (or pass an empty array) to keep the chart exactly as before — fully
   * backward compatible. */
  annotations?: Annotation[];
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A ringed anomaly marker rendered as `ReferenceDot`'s custom `shape`. Spike vs. dip differ by
 * both shape (triangle pointing up vs. down) AND color (`--accent` vs. `--danger`) — dataviz rule:
 * identity/meaning never rests on color alone. `role="img"` + `aria-label` make each marker
 * independently announced, on top of the chart's own figure-level label and the data table.
 */
function AnomalyMarker({
  cx,
  cy,
  direction,
  ariaLabel,
}: {
  cx?: number;
  cy?: number;
  direction: Anomaly['direction'];
  ariaLabel: string;
}) {
  if (cx === undefined || cy === undefined) return <g />;
  const color = direction === 'spike' ? 'var(--accent)' : 'var(--danger)';
  const trianglePoints =
    direction === 'spike'
      ? `${cx},${cy - 5} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}`
      : `${cx - 5},${cy - 4} ${cx + 5},${cy - 4} ${cx},${cy + 5}`;
  return (
    <g role="img" aria-label={ariaLabel} data-anomaly-direction={direction}>
      <circle cx={cx} cy={cy} r={8} fill="none" stroke={color} strokeWidth={2} />
      <polygon points={trianglePoints} fill={color} />
    </g>
  );
}

const ANNOTATION_LABEL_MAX_CHARS = 14;

function truncateLabel(label: string): string {
  return label.length > ANNOTATION_LABEL_MAX_CHARS
    ? `${label.slice(0, ANNOTATION_LABEL_MAX_CHARS - 1)}…`
    : label;
}

/**
 * The label rendered above an annotation's `ReferenceLine` (feat-08 §3): a small, truncated text
 * tag plus an accessible `<title>` + `role="img"`/`aria-label` carrying the untruncated
 * "label — date", mirroring `AnomalyMarker`'s accessible-marker pattern. Returned as a factory so
 * each `ReferenceLine.label` closes over its own annotation; Recharts calls it with the line's
 * computed `viewBox`, from which only the x position (and top y) is needed to place the tag.
 */
function annotationLabelRenderer(annotation: Annotation) {
  return ({ viewBox }: { viewBox?: { x?: number; y?: number } }) => {
    if (!viewBox || viewBox.x === undefined) return <g />;
    const titleText = `${annotation.label} — ${annotation.date}`;
    return (
      <g role="img" aria-label={titleText}>
        <title>{titleText}</title>
        <text
          x={viewBox.x}
          y={(viewBox.y ?? 0) + 10}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-muted)"
        >
          {truncateLabel(annotation.label)}
        </text>
      </g>
    );
  };
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
  anomalies,
  annotations,
}: ComparisonTrendProps) {
  const chartId = useId();
  const currentGradientId = seriesGradientId(chartId, 0);
  const hasPrevious = !!previous && previous.length > 0;
  const hasAnomalies = !!anomalies && anomalies.length > 0;
  const currentColor = colorForIndex(0);
  const animation = chartAnimationProps();

  const rows = current.map((row, index) => ({
    x: row[xKey],
    current: row[valueKey],
    previous: hasPrevious ? previous![index]?.[valueKey] : undefined,
  }));

  // Only an annotation whose date matches one of this chart's own x-axis bucket values falls
  // "within the x-domain" (feat-08 §3/§4) — everything else is skipped here (still stored/listed
  // by the Notes manager), since buckets may be day/week/month and a naive date-range check would
  // otherwise place a marker between ticks where it doesn't actually align with the data.
  const xValues = new Set(rows.map((row) => String(row.x)));
  const inRangeAnnotations = (annotations ?? []).filter((a) => xValues.has(a.date));
  const hasAnnotations = inRangeAnnotations.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <defs>
              <SeriesGradient id={currentGradientId} color={currentColor} />
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="x" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip content={<ChartTooltip />} />
            {hasPrevious && <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />}
            <Area
              type="monotone"
              dataKey="current"
              name="Current"
              stroke={currentColor}
              strokeWidth={2}
              fill={`url(#${currentGradientId})`}
              fillOpacity={1}
              activeDot={{ r: 4, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
              {...animation}
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
                {...animation}
              />
            )}
            {hasAnomalies &&
              anomalies!.map((anomaly) => {
                const row = rows[anomaly.index];
                if (!row || typeof row.current !== 'number') return null;
                const directionLabel = anomaly.direction === 'spike' ? 'Spike' : 'Dip';
                const markerAriaLabel = `${directionLabel} anomaly at ${String(row.x)}: ${formatExactNumber(row.current)}`;
                return (
                  <ReferenceDot
                    key={`anomaly-${anomaly.index}`}
                    x={row.x}
                    y={row.current}
                    r={8}
                    ifOverflow="extendDomain"
                    shape={(shapeProps: { cx?: number; cy?: number }) => (
                      <AnomalyMarker
                        cx={shapeProps.cx}
                        cy={shapeProps.cy}
                        direction={anomaly.direction}
                        ariaLabel={markerAriaLabel}
                      />
                    )}
                  />
                );
              })}
            {hasAnnotations &&
              inRangeAnnotations.map((annotation) => (
                <ReferenceLine
                  key={`annotation-${annotation.id}`}
                  x={annotation.date}
                  stroke={annotation.color ?? 'var(--text-muted)'}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                  label={annotationLabelRenderer(annotation)}
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasAnomalies && <p className="text-xs text-text-muted">△ anomaly</p>}

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
