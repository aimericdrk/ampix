import type { Anomaly } from '../../anomaly';
import { formatExactNumber } from '../../format';

const DEFAULT_MAX_ITEMS = 5;

export interface AnomalyCalloutProps {
  anomalies: Anomaly[];
  /** Caps the rendered list to the top-N by score (feat-07 §4 "degenerate but valid" — every
   * point flagged shouldn't produce an unreadable wall of text). @defaultValue 5 */
  maxItems?: number;
}

/** `(value - baselineMean) / baselineMean` as a rounded percent; `null` when the baseline mean is
 * 0 (division by zero has no meaningful percent — the caller falls back to an absolute delta). */
function pctVsBaseline(anomaly: Anomaly): number | null {
  if (anomaly.baselineMean === 0) return null;
  return Math.round(((anomaly.value - anomaly.baselineMean) / anomaly.baselineMean) * 1000) / 10;
}

/** Plain-language "date · direction · magnitude vs. baseline" line for one anomaly. */
function describeAnomaly(anomaly: Anomaly): string {
  const pct = pctVsBaseline(anomaly);
  if (pct !== null) {
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct}% vs. local baseline`;
  }
  // Guard: a zero local baseline makes a percent meaningless — show the absolute value instead.
  const sign = anomaly.value >= 0 ? '+' : '';
  return `${sign}${formatExactNumber(anomaly.value)} vs. local baseline of 0`;
}

/**
 * The plain-language anomaly summary that sits under a trend chart (feat-07 §3): "N anomalies
 * detected" plus a short, score-ranked list of "date · spike/dip · magnitude vs. baseline" lines.
 * Renders nothing when there's nothing to report, so it's always safe to mount unconditionally
 * alongside `ComparisonTrend`.
 */
export function AnomalyCallout({ anomalies, maxItems = DEFAULT_MAX_ITEMS }: AnomalyCalloutProps) {
  if (anomalies.length === 0) return null;

  const ranked = [...anomalies].sort((a, b) => b.score - a.score).slice(0, maxItems);

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-border bg-bg/40 p-3 text-sm"
    >
      <p className="font-medium">{anomalies.length} anomalies detected</p>
      <ul className="flex flex-col gap-1 text-text-muted">
        {ranked.map((anomaly) => (
          <li key={anomaly.index}>
            <span className="font-medium text-text">{anomaly.t}</span>{' '}
            <span className={anomaly.direction === 'spike' ? 'text-accent' : 'text-danger'}>
              {anomaly.direction}
            </span>{' '}
            {describeAnomaly(anomaly)}
          </li>
        ))}
      </ul>
    </div>
  );
}
