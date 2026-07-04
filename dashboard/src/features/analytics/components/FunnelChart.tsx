import { useMemo } from 'react';
import { formatExactNumber, formatPercent } from '../format';
import { assignSeriesColors, seriesKey } from '../palette';
import type { FunnelBreakdownResult, FunnelResultStep } from '../../../lib/api/types';

/**
 * Funnel = magnitude over ordered steps → one horizontal bar per step (bar length = users reaching
 * the step, normalized to step 0). Each bar is direct-labeled with its user count and conversion %
 * (from the previous step and from the top), so identity/value never rests on color alone. A single
 * funnel is one series and needs no legend (the title names it); a breakdown draws one funnel per
 * value in the fixed-order categorical palette (var(--series-N)) with a legend. An always-present
 * data table underneath is the accessible view.
 */
export function FunnelChart({
  steps,
  overallConversion,
  breakdowns,
}: {
  steps: FunnelResultStep[];
  overallConversion: number;
  breakdowns?: FunnelBreakdownResult[];
}) {
  const hasBreakdown = Boolean(breakdowns && breakdowns.length > 0);

  const breakdownColors = useMemo(() => {
    if (!breakdowns || breakdowns.length === 0) return null;
    const identities = breakdowns.map((b) => ({ name: b.value, breakdown_value: null }));
    return assignSeriesColors(
      identities,
      breakdowns.map((b) => b.value),
    );
  }, [breakdowns]);

  const colorFor = (value: string) =>
    breakdownColors?.get(seriesKey(value, null)) ?? 'var(--series-1)';

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-text-muted">
        Overall conversion:{' '}
        <span className="font-semibold text-text tabular-nums">
          {formatPercent(overallConversion)}
        </span>
      </p>

      {hasBreakdown && breakdowns ? (
        <>
          <ul aria-label="Funnel breakdown legend" className="flex flex-wrap gap-4">
            {breakdowns.map((b) => (
              <li key={b.value} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: colorFor(b.value) }}
                />
                {b.value}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-8">
            {breakdowns.map((b) => (
              <FunnelBars
                key={b.value}
                title={b.value}
                steps={b.steps}
                color={colorFor(b.value)}
              />
            ))}
          </div>
        </>
      ) : (
        <FunnelBars steps={steps} color="var(--series-1)" />
      )}

      <FunnelTable steps={steps} breakdowns={breakdowns} />
    </div>
  );
}

function FunnelBars({
  steps,
  color,
  title,
}: {
  steps: FunnelResultStep[];
  color: string;
  title?: string;
}) {
  const topCount = steps[0]?.count ?? 0;
  return (
    <div
      role="img"
      aria-label={title ? `Funnel for ${title}` : 'Funnel chart'}
      className="flex flex-col gap-3"
    >
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      {steps.map((step, index) => {
        const widthPct = topCount > 0 ? (step.count / topCount) * 100 : 0;
        return (
          <div key={`${step.event}-${index}`} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">
                {index + 1}. {step.event}
              </span>
              <span className="tabular-nums text-text-muted">
                <span className="font-semibold text-text">{formatExactNumber(step.count)}</span>{' '}
                users · {formatPercent(step.conversion_from_prev)} from prev ·{' '}
                {formatPercent(step.conversion_from_top)} from top
              </span>
            </div>
            {/* Recessive full-width track; the filled bar is anchored to the left baseline with a
                rounded data-end. One measure = one axis (normalized to step 0). */}
            <div className="h-6 w-full overflow-hidden rounded-sm bg-border/40">
              <div
                className="h-full rounded-sm"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
                title={`${step.event}: ${formatExactNumber(step.count)} users`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FunnelTable({
  steps,
  breakdowns,
}: {
  steps: FunnelResultStep[];
  breakdowns?: FunnelBreakdownResult[];
}) {
  const hasBreakdown = Boolean(breakdowns && breakdowns.length > 0);
  const rows: { series: string; step: FunnelResultStep; index: number }[] = [];
  steps.forEach((step, index) => rows.push({ series: 'All', step, index }));
  breakdowns?.forEach((b) =>
    b.steps.forEach((step, index) => rows.push({ series: b.value, step, index })),
  );

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-text-muted">Table</h3>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Funnel data table</caption>
        <thead>
          <tr className="border-b border-border">
            {hasBreakdown && (
              <th scope="col" className="py-2 font-medium">
                Series
              </th>
            )}
            <th scope="col" className="py-2 font-medium">
              Step
            </th>
            <th scope="col" className="py-2 font-medium">
              Event
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Users
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              From previous
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              From top
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ series, step, index }) => (
            <tr key={`${series}-${index}-${step.event}`} className="border-b border-border">
              {hasBreakdown && <td className="py-2">{series}</td>}
              <td className="py-2 tabular-nums">{index + 1}</td>
              <td className="py-2">{step.event}</td>
              <td className="py-2 text-right tabular-nums">{formatExactNumber(step.count)}</td>
              <td className="py-2 text-right tabular-nums">
                {formatPercent(step.conversion_from_prev)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatPercent(step.conversion_from_top)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
