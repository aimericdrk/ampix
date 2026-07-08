import type { EngagementNewReturningPoint } from '../../../../lib/api/types';
import { formatExactNumber } from '../../format';
import { colorForIndex } from '../../palette';
import { StackedBarChart } from './SeriesCharts';

const KEYS = ['new', 'returning'];
const LABELS = new Map<string, string>([
  ['new', 'New'],
  ['returning', 'Returning'],
]);

/** `new` is the accent (index 0), `returning` the second palette color (index 1) — fixed order,
 * matching the dataviz "identity never rests on rank" rule the rest of the chart set follows. */
function colorFor(key: string): string {
  return key === 'new' ? colorForIndex(0) : colorForIndex(1);
}

/**
 * Composition-over-time for the engagement endpoint's `new_vs_returning` series (feat-11 §3): a
 * stacked bar of `new` (first-ever-event users) + `returning` (previously-seen active users) per
 * bucket, reusing `StackedBarChart`'s axis/tooltip/legend conventions rather than reinventing them.
 * Ships an accessible data table (`t`, new, returning, total) underneath, mirroring
 * `ComparisonTrend`/`BreakdownChart` — identity and magnitude never rest on bar color alone.
 */
export function LifecycleChart({
  points,
  ariaLabel = 'User lifecycle trend',
  height = 320,
}: {
  points: EngagementNewReturningPoint[];
  ariaLabel?: string;
  height?: number;
}) {
  const rows: Array<Record<string, string | number>> = points.map((p) => ({
    t: p.t,
    new: p.new,
    returning: p.returning,
  }));

  return (
    <div className="flex flex-col gap-4">
      <StackedBarChart
        rows={rows}
        keys={KEYS}
        labels={LABELS}
        colorFor={colorFor}
        ariaLabel={ariaLabel}
        height={height}
      />
      <LifecycleTable points={points} ariaLabel={ariaLabel} />
    </div>
  );
}

function LifecycleTable({
  points,
  ariaLabel,
}: {
  points: EngagementNewReturningPoint[];
  ariaLabel: string;
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{`${ariaLabel} data table`}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 font-medium">
            Date
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            New
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Returning
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.t} className="border-b border-border">
            <td className="py-2">{point.t}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(point.new)}</td>
            <td className="py-2 text-right tabular-nums">{formatExactNumber(point.returning)}</td>
            <td className="py-2 text-right tabular-nums font-medium">
              {formatExactNumber(point.new + point.returning)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
