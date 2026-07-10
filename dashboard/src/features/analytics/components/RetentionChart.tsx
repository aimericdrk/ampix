import { useMemo } from 'react';
import { cn } from '../../../lib/cn';
import { formatExactNumber, formatPercent } from '../format';
import type {
  RetentionAveragePoint,
  RetentionCohort,
  RetentionInterval,
} from '../../../lib/api/types';

/** Bucket a rate in [0,1] into one of the 7 sequential ramp levels (0 = low, 6 = high). */
function rampLevel(rate: number): number {
  return Math.min(6, Math.max(0, Math.floor(rate * 7)));
}

function cellStyle(rate: number) {
  const level = rampLevel(rate);
  return {
    backgroundColor: `var(--retention-${level}-bg)`,
    color: `var(--retention-${level}-fg)`,
  };
}

/**
 * Retention = a cohort grid / heatmap: rows are cohorts (birth bucket), columns are period 0..N,
 * and each cell encodes the retention RATE on a sequential single-hue ramp (light→dark = low→high).
 * Every cell ALSO prints its numeric rate and the grid is a real, accessible table — so identity
 * is never color-alone. Cohort size is shown per row and the size-weighted average is a footer row.
 */
export function RetentionChart({
  cohorts,
  averages,
  interval,
}: {
  cohorts: RetentionCohort[];
  averages: RetentionAveragePoint[];
  interval: RetentionInterval;
}) {
  const maxPeriod = useMemo(() => {
    let max = 0;
    for (const c of cohorts) for (const p of c.periods) max = Math.max(max, p.period);
    for (const a of averages) max = Math.max(max, a.period);
    return max;
  }, [cohorts, averages]);

  const periodColumns = Array.from({ length: maxPeriod + 1 }, (_, i) => i);
  const columnLabel = interval === 'week' ? 'Week' : 'Day';
  const totalSize = cohorts.reduce((sum, c) => sum + c.size, 0);

  const averageByPeriod = new Map(averages.map((a) => [a.period, a.rate]));

  return (
    <div className="flex flex-col gap-4">
      <RampLegend />
      <div className="overflow-x-auto">
        <table
          aria-label="Retention cohort heatmap"
          className="border-separate border-spacing-[1px] text-right text-sm"
        >
          <caption className="sr-only">
            Retention by cohort and {columnLabel.toLowerCase()} period
          </caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border px-3 py-2 text-left font-medium">
                Cohort
              </th>
              <th scope="col" className="border-b border-border px-3 py-2 font-medium">
                Size
              </th>
              {periodColumns.map((period) => (
                <th
                  key={period}
                  scope="col"
                  className="border-b border-border px-3 py-2 font-medium"
                >
                  {columnLabel} {period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => {
              const byPeriod = new Map(cohort.periods.map((p) => [p.period, p]));
              return (
                <tr key={cohort.cohort}>
                  <th
                    scope="row"
                    className="rounded border-b border-border px-3 py-2 text-left font-medium tabular-nums"
                  >
                    {cohort.cohort}
                  </th>
                  <td className="rounded border-b border-border px-3 py-2 tabular-nums">
                    {formatExactNumber(cohort.size)}
                  </td>
                  {periodColumns.map((period) => {
                    const cell = byPeriod.get(period);
                    if (!cell) {
                      return (
                        <td
                          key={period}
                          className="rounded border-b border-border px-3 py-2 text-text-muted"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td
                        key={period}
                        className="rounded border-b border-border px-3 py-2 tabular-nums transition-shadow hover:ring-1 hover:ring-accent"
                        style={cellStyle(cell.rate)}
                        title={`${formatExactNumber(cell.count)} users`}
                      >
                        {formatPercent(cell.rate)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="rounded border-t-2 border-border px-3 py-2 text-left font-medium">
                Average
              </th>
              <td className="rounded border-t-2 border-border px-3 py-2 tabular-nums">
                {formatExactNumber(totalSize)}
              </td>
              {periodColumns.map((period) => {
                const rate = averageByPeriod.get(period);
                if (rate === undefined) {
                  return (
                    <td
                      key={period}
                      className="rounded border-t-2 border-border px-3 py-2 text-text-muted"
                    >
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={period}
                    className={cn(
                      'rounded border-t-2 border-border px-3 py-2 font-medium tabular-nums',
                      'transition-shadow hover:ring-1 hover:ring-accent',
                    )}
                    style={cellStyle(rate)}
                  >
                    {formatPercent(rate)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** A small gradient key so the light→dark ramp reads as low→high retention. */
function RampLegend() {
  const levels = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <span>Low</span>
      <div className="flex gap-px" aria-hidden="true">
        {levels.map((level) => (
          <span
            key={level}
            className="inline-block h-3 w-4 rounded-sm"
            style={{ backgroundColor: `var(--retention-${level}-bg)` }}
          />
        ))}
      </div>
      <span>High retention</span>
    </div>
  );
}
