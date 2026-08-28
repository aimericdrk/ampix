import type {
  JourneyFrequencyRow,
  JourneyPathStep,
  JourneyQuantiles,
  JourneySummaryMetric,
} from '../../../lib/api/types';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../lib/cn';
import { formatDurationMs, formatExactNumber, formatPercent } from '../../analytics/format';

/** Human copy for each metric key. The API ships a `definition` per metric — that is the precise
 *  statement, shown as the row's hint; this is just the short label for the column. */
const METRIC_LABELS: Record<JourneySummaryMetric['metric'], string> = {
  steps_before: 'Events before',
  sessions_before: 'Sessions before',
  distinct_events_before: 'Distinct events before',
  days_to_outcome: 'Time to outcome',
};

/** A lift is only worth reading as a signal once it is clearly away from parity; between 0.8 and
 *  1.25 the two groups did roughly the same thing, and colouring that as a win would be a lie. */
const LIFT_FLOOR = 0.8;
const LIFT_CEILING = 1.25;

export function formatLift(lift: number | null): string {
  if (lift === null) return '—';
  return `${lift.toFixed(lift >= 10 ? 0 : 1)}×`;
}

function liftTone(lift: number | null): string {
  if (lift === null) return 'text-text-muted';
  if (lift >= LIFT_CEILING) return 'text-accent';
  if (lift <= LIFT_FLOOR) return 'text-danger';
  return 'text-text-muted';
}

/** The lift figure with a glyph beside it, so the comparison never rests on colour alone. */
export function LiftCell({ lift }: { lift: number | null }) {
  const glyph = lift === null ? '' : lift >= LIFT_CEILING ? '▲ ' : lift <= LIFT_FLOOR ? '▼ ' : '≈ ';
  return (
    <span className={cn('tabular-nums', liftTone(lift))}>
      <span aria-hidden="true">{glyph}</span>
      {formatLift(lift)}
    </span>
  );
}

function formatQuantiles(q: JourneyQuantiles | null, unit: JourneySummaryMetric['unit']): string {
  if (q === null) return '—';
  const fmt = (value: number) =>
    unit === 'days' ? `${value.toFixed(1)}d` : formatExactNumber(Math.round(value * 10) / 10);
  return `${fmt(q.median)}  (${fmt(q.p25)}–${fmt(q.p75)})`;
}

/**
 * The headline comparison: one row per metric, cohort median against control median with the
 * interquartile range in brackets. The range is shown rather than hidden because a median alone
 * invites a confidence the spread often does not support.
 */
export function SummaryTable({
  metrics,
  cohortLabel,
}: {
  metrics: JourneySummaryMetric[];
  cohortLabel: string;
}) {
  const columns: Array<DataTableColumn<JourneySummaryMetric>> = [
    {
      key: 'metric',
      header: 'Metric',
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{METRIC_LABELS[row.metric]}</span>
          <span className="text-xs text-text-muted">{row.definition}</span>
        </div>
      ),
    },
    {
      key: 'cohort',
      header: cohortLabel,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">{formatQuantiles(row.cohort, row.unit)}</span>
      ),
    },
    {
      key: 'control',
      header: 'Everyone else',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-text-muted">
          {formatQuantiles(row.control, row.unit)}
        </span>
      ),
    },
    { key: 'lift', header: 'Lift', align: 'right', render: (row) => <LiftCell lift={row.lift} /> },
  ];

  return (
    <DataTable
      caption="Cohort versus control, median with interquartile range"
      columns={columns}
      rows={metrics}
      rowKey={(row) => row.metric}
    />
  );
}

/** Below this, the "typical path" is not typical: fewer than a third of the cohort took this step
 *  at this position, so presenting it as the route would misrepresent the data. */
const WEAK_SHARE = 0.34;

/**
 * The reconstructed path, oldest step first, ending at the outcome. Each step carries the share of
 * the cohort that actually took it — the number that decides whether the path means anything — and
 * the median time from there to the outcome.
 */
export function PathTimeline({
  steps,
  outcomeLabel,
  cohortUsers,
}: {
  steps: JourneyPathStep[];
  outcomeLabel: string;
  cohortUsers: number;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No events recorded in the window before the outcome, so there is no path to reconstruct.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1">
      {steps.map((step) => {
        const weak = step.share < WEAK_SHARE;
        return (
          <li
            key={step.steps_before_outcome}
            className="relative flex items-center gap-3 rounded-lg px-3 py-2"
          >
            {/* The share bar is a background fill, not a separate column: the row's own width IS
                the 100% reference, so the bar needs no axis to be readable. */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 rounded-lg bg-accent-soft"
              style={{ width: `${Math.max(2, step.share * 100)}%` }}
            />
            <span className="relative w-6 shrink-0 text-xs tabular-nums text-text-muted">
              −{step.steps_before_outcome}
            </span>
            <span className="relative min-w-0 flex-1 truncate text-sm font-medium">
              {step.event}
              {step.screen_name && (
                <span className="ml-1 font-normal text-text-muted">{step.screen_name}</span>
              )}
            </span>
            <span
              className={cn(
                'relative shrink-0 text-xs tabular-nums',
                weak ? 'text-text-muted' : 'text-text',
              )}
              title={`${formatExactNumber(step.users)} of ${formatExactNumber(cohortUsers)} users`}
            >
              {formatPercent(step.share)}
            </span>
            <span className="relative w-20 shrink-0 text-right text-xs tabular-nums text-text-muted">
              {formatDurationMs(step.median_seconds_to_outcome * 1000)} before
            </span>
          </li>
        );
      })}
      <li className="flex items-center gap-3 rounded-lg bg-accent-soft px-3 py-2">
        <span className="w-6 shrink-0 text-xs tabular-nums text-accent">0</span>
        <span className="flex-1 text-sm font-semibold text-accent">{outcomeLabel}</span>
        <Badge variant="accent">{formatExactNumber(cohortUsers)} users</Badge>
      </li>
    </ol>
  );
}

/**
 * Per-user frequency, cohort against control. Both columns are averaged over EVERY user in their
 * group — including those who never did the thing — so the two are directly comparable and a rare
 * behaviour cannot masquerade as a common one.
 */
export function FrequencyTable({
  rows,
  cohortLabel,
  nameHeader,
  caption,
}: {
  rows: JourneyFrequencyRow[];
  cohortLabel: string;
  nameHeader: string;
  caption: string;
}) {
  const columns: Array<DataTableColumn<JourneyFrequencyRow>> = [
    { key: 'name', header: nameHeader, sortable: true },
    {
      key: 'cohort_per_user',
      header: `${cohortLabel} / user`,
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="tabular-nums">
          {row.cohort_per_user.toFixed(2)}
          <span className="ml-1 text-xs text-text-muted">
            ({formatPercent(row.cohort_user_share)})
          </span>
        </span>
      ),
      sortValue: (row) => row.cohort_per_user,
    },
    {
      key: 'control_per_user',
      header: 'Everyone else / user',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="tabular-nums text-text-muted">
          {row.control_per_user.toFixed(2)}
          <span className="ml-1 text-xs">({formatPercent(row.control_user_share)})</span>
        </span>
      ),
      sortValue: (row) => row.control_per_user,
    },
    {
      key: 'lift',
      header: 'Lift',
      align: 'right',
      sortable: true,
      render: (row) => <LiftCell lift={row.lift} />,
      // Nulls sort last: an undefined ratio is not the smallest one.
      sortValue: (row) => row.lift ?? -1,
    },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.name}
      initialSort={{ key: 'cohort_per_user', dir: 'desc' }}
      exportFilename={`journey-${nameHeader.toLowerCase()}`}
    />
  );
}
