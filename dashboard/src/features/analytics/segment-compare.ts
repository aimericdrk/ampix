import type { InsightsResponse, InsightsSeries } from '../../lib/api/types';
import { sumSeries } from './derive';

/** One selected segment's name (chart legend label) plus its Insights result, if it has resolved. */
export interface SegmentSeriesInput {
  name: string;
  response: InsightsResponse | undefined;
}

export interface CombinedSegmentSeries {
  /** One `InsightsSeries` per (segment × underlying series), renamed for the chart legend, in the
   * same order as the input segments (color stability — colors key off this order, never a
   * response's array order). */
  series: InsightsSeries[];
  /** One total per segment, in input order — the per-segment summary row's source of truth. */
  totals: Array<{ name: string; total: number }>;
}

/**
 * Merges N independent Insights responses (one per compared segment, each run with that segment's
 * `cohort_id` against the same query definition — feat-04 §3.2) into a single multi-series dataset
 * the existing `InsightsChart` can render as one overlay, plus a per-segment total for the summary
 * row below it.
 *
 * A compare-mode base query has exactly one event, so a segment's response is normally a single
 * series — it's renamed to just the segment name, which is what should show up in the legend. If a
 * segment's response ever carries more than one series (e.g. a breakdown snuck in), each of that
 * segment's series is prefixed with the segment name instead, so identity is never lost.
 *
 * A segment with no response yet (still loading — callers should gate this out — or errored) or an
 * empty result set (`series: []`, e.g. an empty cohort) still gets an entry: a flat, empty series
 * under its name and a total of 0, so it stays legended/labelled rather than silently vanishing
 * (feat-04 §4).
 */
export function combineSegmentSeries(perSegment: SegmentSeriesInput[]): CombinedSegmentSeries {
  const series: InsightsSeries[] = [];
  const totals: Array<{ name: string; total: number }> = [];

  for (const segment of perSegment) {
    const segmentSeries = segment.response?.series ?? [];

    if (segmentSeries.length === 0) {
      series.push({ name: segment.name, breakdown_value: null, data: [] });
      totals.push({ name: segment.name, total: 0 });
      continue;
    }

    const prefixNames = segmentSeries.length > 1;
    for (const s of segmentSeries) {
      series.push({
        ...s,
        name: prefixNames ? `${segment.name} · ${s.name}` : segment.name,
      });
    }
    totals.push({ name: segment.name, total: sumSeries(segmentSeries) });
  }

  return { series, totals };
}
