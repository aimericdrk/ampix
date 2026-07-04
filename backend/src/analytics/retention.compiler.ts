import {
  CohortPredicate,
  applyCohortPredicate,
  compileDateRange,
  compileFilterClauses,
} from './filter-compiler';
import type { RetentionInterval, RetentionQuery } from './retention.schema';

/**
 * Structural keywords selected by the validated `interval` enum (contracts §15) — OUR OWN frozen
 * constants, never raw input. `BUCKET_FN` buckets a timestamp; `DATEDIFF_UNIT` is the unit passed
 * to `dateDiff('<unit>', ...)`.
 */
const RETENTION_BUCKET_FN: Readonly<Record<RetentionInterval, string>> = Object.freeze({
  day: 'toStartOfDay',
  week: 'toMonday',
});
const RETENTION_DATEDIFF_UNIT: Readonly<Record<RetentionInterval, string>> = Object.freeze({
  day: 'day',
  week: 'week',
});

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}

export interface CompiledRetentionQuery {
  /** Cohort sizes: one row per born bucket -> `{ cohort, size }`. */
  sizesQuery: CompiledQuery;
  /** Return grid: `{ cohort, period, cnt }` for `1 <= period <= periods` (period 0 == size). */
  gridQuery: CompiledQuery;
}

/**
 * Builds the shared "born" subquery: per-user first (min) bucket over `born_event` rows in the
 * cohort birth window. Filters are indexed from `filterOffset` so they never collide with the
 * return filters that live in the same SQL string.
 */
function bornSubquery(
  query: RetentionQuery,
  bucketFn: string,
  params: Record<string, unknown>,
  filterOffset: number,
  cohort?: CohortPredicate,
): string {
  const clauses = [
    'project_id = {projectId:UUID}',
    'event = {bornEvent:String}',
    'timestamp >= {from:DateTime64}',
    'timestamp < {toExclusive:DateTime64}',
    ...compileFilterClauses(query.born_event.filters, params, filterOffset),
  ];
  // §16 cohort_id filter: the cohort narrows WHO is "born" (cohort membership defines the cohort rows).
  applyCohortPredicate(clauses, params, cohort);
  return [
    '  SELECT distinct_id,',
    `    min(${bucketFn}(timestamp)) AS cohort`,
    '  FROM events',
    `  WHERE ${clauses.join('\n    AND ')}`,
    '  GROUP BY distinct_id',
  ].join('\n');
}

/**
 * Compiles a validated {@link RetentionQuery} into two fully-parameterized ClickHouse queries
 * (contracts §15). Pure. `return_event` defaults to `born_event`. The born filters (offset 0) and
 * the return filters (offset = born-filter count) share the grid SQL string, so their param names
 * are threaded to stay globally unique. Cohort labels are `YYYY-MM-DD`; the service trims periods
 * that have not fully elapsed by the `to` bound.
 */
export function compileRetentionQuery(
  query: RetentionQuery,
  projectId: string,
  cohort?: CohortPredicate,
): CompiledRetentionQuery {
  const bucketFn = RETENTION_BUCKET_FN[query.interval];
  const unit = RETENTION_DATEDIFF_UNIT[query.interval];
  const returnEvent = query.return_event ?? query.born_event;
  const bornFilterCount = query.born_event.filters.length;

  const dateRange = compileDateRange(query.date_range.from, query.date_range.to);

  // --- sizes query (born cohort sizes) ---
  const sizesParams: Record<string, unknown> = {
    projectId,
    bornEvent: query.born_event.name,
    ...dateRange,
  };
  const sizesSql = [
    'SELECT',
    '  toString(toDate(b.cohort)) AS cohort,',
    '  uniqExact(b.distinct_id) AS size',
    'FROM (',
    bornSubquery(query, bucketFn, sizesParams, 0, cohort),
    ') AS b',
    'GROUP BY b.cohort',
    'ORDER BY b.cohort',
  ].join('\n');

  // --- grid query (return counts per period) ---
  const gridParams: Record<string, unknown> = {
    projectId,
    bornEvent: query.born_event.name,
    returnEvent: returnEvent.name,
    periods: query.periods,
    ...dateRange,
  };
  const returnClauses = [
    'project_id = {projectId:UUID}',
    'event = {returnEvent:String}',
    'timestamp < {toExclusive:DateTime64}',
    ...compileFilterClauses(returnEvent.filters, gridParams, bornFilterCount),
  ];
  const gridSql = [
    'SELECT',
    '  toString(toDate(b.cohort)) AS cohort,',
    `  dateDiff('${unit}', b.cohort, r.rbucket) AS period,`,
    '  uniqExact(r.distinct_id) AS cnt',
    'FROM (',
    bornSubquery(query, bucketFn, gridParams, 0, cohort),
    ') AS b',
    'INNER JOIN (',
    '  SELECT distinct_id,',
    `    ${bucketFn}(timestamp) AS rbucket`,
    '  FROM events',
    `  WHERE ${returnClauses.join('\n    AND ')}`,
    ') AS r ON r.distinct_id = b.distinct_id',
    'GROUP BY cohort, period',
    'HAVING period >= 1 AND period <= {periods:UInt16}',
    'ORDER BY cohort, period',
  ].join('\n');

  return {
    sizesQuery: { sql: sizesSql, params: sizesParams },
    gridQuery: { sql: gridSql, params: gridParams },
  };
}
