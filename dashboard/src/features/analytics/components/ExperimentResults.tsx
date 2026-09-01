import { CheckCircle2, CircleSlash, MinusCircle, TriangleAlert } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import type { ExperimentResponse, ExperimentVariantResult } from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { BreakdownChart } from './charts/BreakdownChart';
import { ChartCard } from './charts/ChartCard';
import { KpiTile } from './charts/KpiTile';
import { SectionGrid } from '../../../components/ui/SectionGrid';

/** A proportion as a percentage with one decimal — conversion rates are read at that precision. */
function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** A signed percentage-point difference: `+5.0 pts` / `−1.2 pts`. Uses a real minus sign. */
function points(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${Math.abs(delta * 100).toFixed(1)} pts`;
}

/** A signed relative change: `+50.0%` / `−12.0%`. */
function signedPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}

/**
 * A p-value at the precision it is actually read at. Below 0.001 the exact digits carry no extra
 * meaning to a reader, so it is reported as a bound rather than as `0.000`, which would look like
 * certainty.
 */
export function formatPValue(p: number): string {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

/**
 * The verdict chip for one arm, in the order the reader needs it:
 *  1. the control has no verdict — it IS the baseline;
 *  2. an arm with too few users gets "Not enough data", because a p-value computed on 12 people is
 *     not a result whatever it says;
 *  3. otherwise the significance call, signed so "significantly worse" never reads as a win.
 */
function VariantVerdict({ variant }: { variant: ExperimentVariantResult }) {
  if (variant.is_control) {
    return (
      <Badge variant="outline" className="gap-1">
        <MinusCircle className="size-3" aria-hidden />
        Baseline
      </Badge>
    );
  }
  if (variant.underpowered) {
    return (
      <Badge variant="warning" className="gap-1">
        <TriangleAlert className="size-3" aria-hidden />
        Not enough data
      </Badge>
    );
  }
  const comparison = variant.comparison;
  if (!comparison || comparison.p_value === null) {
    return (
      <Badge variant="outline" className="gap-1">
        <CircleSlash className="size-3" aria-hidden />
        Can't tell
      </Badge>
    );
  }
  if (!comparison.significant) {
    return (
      <Badge variant="default" className="gap-1">
        <MinusCircle className="size-3" aria-hidden />
        No clear difference
      </Badge>
    );
  }
  const better = comparison.absolute_uplift > 0;
  return (
    <Badge variant={better ? 'success' : 'danger'} className="gap-1">
      <CheckCircle2 className="size-3" aria-hidden />
      {better ? 'Significantly better' : 'Significantly worse'}
    </Badge>
  );
}

/**
 * One experiment's readout, shared verbatim by the Experiments page and by a saved `experiment`
 * report (so a pinned result and a live one are the same thing on screen).
 *
 * Three layers, deliberately in this order: the headline totals, the per-arm conversion bars, then
 * the table where the statistics live. The chart alone would let someone call a winner off two bar
 * lengths — which is exactly the mistake an A/B tool exists to prevent — so the significance column
 * sits beside every rate rather than behind a disclosure.
 */
export function ExperimentResults({ result }: { result: ExperimentResponse }) {
  const overallRate =
    result.total_exposed > 0 ? result.total_converted / result.total_exposed : 0;

  const columns: Array<DataTableColumn<ExperimentVariantResult>> = [
    {
      key: 'variant',
      header: 'Variant',
      sortable: true,
      // No "control" marker here: the Verdict column already says "Baseline" for that row, and a
      // second label would just repeat it beside the arm's own name.
      render: (row) => <span className="font-medium">{row.variant}</span>,
    },
    {
      key: 'exposed',
      header: 'Exposed',
      align: 'right',
      sortable: true,
      render: (row) => formatExactNumber(row.exposed),
    },
    {
      key: 'converted',
      header: 'Converted',
      align: 'right',
      sortable: true,
      render: (row) => formatExactNumber(row.converted),
    },
    {
      key: 'conversion_rate',
      header: 'Conversion rate',
      align: 'right',
      sortable: true,
      render: (row) => percent(row.conversion_rate),
    },
    {
      key: 'uplift',
      header: 'Uplift vs control',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.comparison?.relative_uplift ?? 0,
      render: (row) => {
        if (row.is_control) return <span className="text-text-muted">—</span>;
        const comparison = row.comparison;
        if (!comparison) return <span className="text-text-muted">—</span>;
        return (
          <span className="flex flex-col items-end leading-tight">
            <span>
              {comparison.relative_uplift === null
                ? points(comparison.absolute_uplift)
                : signedPercent(comparison.relative_uplift)}
            </span>
            <span className="text-[11px] text-text-muted">
              {points(comparison.absolute_uplift)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'confidence_interval',
      header: '95% CI (pts)',
      align: 'right',
      sortable: false,
      render: (row) => {
        const ci = row.comparison?.confidence_interval;
        if (!ci) return <span className="text-text-muted">—</span>;
        return (
          <span className="tabular-nums text-xs">
            {points(ci.low)} … {points(ci.high)}
          </span>
        );
      },
    },
    {
      key: 'p_value',
      header: 'p-value',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.comparison?.p_value ?? 1,
      render: (row) => {
        const p = row.comparison?.p_value;
        if (p === null || p === undefined) return <span className="text-text-muted">—</span>;
        return <span className="tabular-nums">{formatPValue(p)}</span>;
      },
    },
    {
      key: 'verdict',
      header: 'Verdict',
      sortable: false,
      render: (row) => <VariantVerdict variant={row} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionGrid>
        <KpiTile label="Participants" value={result.total_exposed} />
        <KpiTile label="Conversions" value={result.total_converted} />
        <KpiTile label="Overall rate" value={percent(overallRate)} />
        <KpiTile label="Variants" value={result.variants.length} />
      </SectionGrid>

      {!result.has_enough_data && result.variants.length > 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            At least one variant has too few participants for the significance test to be
            trustworthy. Keep the test running, or widen the date range, before calling a winner.
          </span>
        </p>
      )}

      <ChartCard
        title="Conversion rate by variant"
        description={
          result.control_variant
            ? `Every variant is compared against "${result.control_variant}".`
            : 'No participants in this range.'
        }
        state={result.variants.length === 0 ? 'empty' : 'ready'}
        exportImageName="experiment-conversion-by-variant"
      >
        <BreakdownChart
          ariaLabel="Conversion rate by variant"
          data={result.variants.map((variant) => ({
            label: variant.variant,
            // Percentage points, so the bars are read on the same scale as the table's rates.
            value: Number((variant.conversion_rate * 100).toFixed(2)),
          }))}
        />
      </ChartCard>

      {result.variants.length > 0 && (
        <DataTable
          caption="Per-variant conversion, uplift against the control, and statistical significance"
          columns={columns}
          rows={result.variants}
          rowKey={(row) => row.variant}
          exportFilename="experiment-results"
        />
      )}
    </div>
  );
}
