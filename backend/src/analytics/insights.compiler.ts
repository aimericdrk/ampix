import type { ClickHouseSettings } from '@clickhouse/client';
import { BUCKET_EXPR, Bucket, buildBucketGrid } from './bucket-grid';
import {
  CohortPredicate,
  applyCohortPredicate,
  compileDateRange,
  compileFilterClauses,
} from './filter-compiler';
import { canonicalization } from './identity';
import type { InsightsEvent, InsightsQuery } from './insights-query.schema';
import { resolveProperty } from './property-resolver';

/** contracts §14: breakdown series are capped at the top 20 values. */
export const MAX_BREAKDOWN_VALUES = 20;

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}

export interface CompiledEventSeriesQuery extends CompiledQuery {
  eventName: string;
  /**
   * ClickHouse settings this query MUST run with, when present. The `unique_users` aggregation
   * canonicalizes ids (contracts §17) via a LEFT JOIN whose `coalesce(...)` is only correct under
   * `join_use_nulls=1`; `total` queries carry no settings (default behavior).
   */
  settings?: ClickHouseSettings;
}

export interface CompiledInsightsQuery {
  buckets: Bucket[];
  hasBreakdown: boolean;
  /**
   * Only present when the query has a `breakdown` — discovers the top {@link MAX_BREAKDOWN_VALUES}
   * values across ALL selected events (ranked by total row volume) before the per-event series
   * queries run.
   */
  topBreakdownValuesQuery?: CompiledQuery;
  /**
   * One per `events[]` entry, in the same order. When `hasBreakdown` is true, the SQL text
   * already references `{breakdownValues:Array(String)}`; the caller must merge in a
   * `breakdownValues: string[]` param (the result of running {@link topBreakdownValuesQuery})
   * before executing — the compiler never invents that value itself, it only compiles SQL.
   */
  seriesQueries: CompiledEventSeriesQuery[];
}

/** The `total` aggregation expression. `unique_users` is compiled separately (it canonicalizes). */
function totalExpr(): string {
  return 'count(DISTINCT insert_id)';
}

/** `timestamp >= {from:DateTime64} AND timestamp < {to+1day}` (contracts §14: inclusive dates). */
function dateRangeParams(query: InsightsQuery): { from: string; toExclusive: string } {
  return compileDateRange(query.date_range.from, query.date_range.to);
}

function compileTopBreakdownValuesQuery(
  query: InsightsQuery,
  projectId: string,
  cohort?: CohortPredicate,
): CompiledQuery {
  const params: Record<string, unknown> = {
    projectId,
    eventNames: query.events.map((event) => event.name),
    ...dateRangeParams(query),
  };
  // Non-null: only called when `query.breakdown` is set (see compileInsightsQuery).
  const { expr: breakdownExpr } = resolveProperty(
    query.breakdown!.property,
    'breakdownKey',
    params,
  );
  const whereClauses = [
    'project_id = {projectId:UUID}',
    'event IN {eventNames:Array(String)}',
    'timestamp >= {from:DateTime64}',
    'timestamp < {toExclusive:DateTime64}',
    ...compileFilterClauses(query.filters, params),
  ];
  applyCohortPredicate(whereClauses, params, cohort);

  const sql = [
    'SELECT',
    `  ${breakdownExpr} AS breakdown_value,`,
    '  count(DISTINCT insert_id) AS total',
    'FROM events',
    `WHERE ${whereClauses.join('\n  AND ')}`,
    'GROUP BY breakdown_value',
    'ORDER BY total DESC',
    `LIMIT ${MAX_BREAKDOWN_VALUES}`,
  ].join('\n');

  return { sql, params };
}

function compileEventSeriesQuery(
  query: InsightsQuery,
  projectId: string,
  event: InsightsEvent,
  bucketExpr: string,
  cohort?: CohortPredicate,
): CompiledEventSeriesQuery {
  const params: Record<string, unknown> = {
    projectId,
    eventName: event.name,
    ...dateRangeParams(query),
  };
  const whereClauses = [
    'project_id = {projectId:UUID}',
    'event = {eventName:String}',
    'timestamp >= {from:DateTime64}',
    'timestamp < {toExclusive:DateTime64}',
    ...compileFilterClauses(query.filters, params),
  ];
  applyCohortPredicate(whereClauses, params, cohort);

  let breakdownSelect = '';
  let groupByExtra = '';
  if (query.breakdown) {
    const { expr: breakdownExpr } = resolveProperty(
      query.breakdown.property,
      'breakdownKey',
      params,
    );
    breakdownSelect = `${breakdownExpr} AS breakdown_value,\n  `;
    groupByExtra = ', breakdown_value';
    // `breakdownValues` is supplied by the caller at execution time, after running
    // topBreakdownValuesQuery — the placeholder is compiled in now, the array value bound later.
    whereClauses.push(`${breakdownExpr} IN {breakdownValues:Array(String)}`);
  }

  // `unique_users` (contracts §17): count DISTINCT *canonical* users, not raw distinct_ids, so an
  // anon→identified user is counted once. The per-event scan (identical to `total`'s, incl. filters,
  // breakdown and any §16 cohort predicate on the raw distinct_id) is wrapped in a subquery `ev`;
  // the outer query LEFT JOINs the alias map and aggregates `uniqExact(uid)`. Wrapping keeps the
  // inner scan free of the join (so its bare column references stay unambiguous) and confines the
  // alias join to the outer projection. `total` stays a single-level scan.
  if (event.aggregation === 'unique_users') {
    const canon = canonicalization('ev.distinct_id');
    // The outer projection reads only the subquery's passthrough columns (`bucket_ts`,
    // `breakdown_value`) — the raw event columns behind `breakdownExpr` are not in scope there.
    const outerBreakdownSelect = query.breakdown ? 'breakdown_value,\n  ' : '';
    const sql = [
      `WITH ${canon.cte}`,
      'SELECT',
      '  bucket_ts,',
      `  ${outerBreakdownSelect}uniqExact(${canon.uid}) AS value`,
      'FROM (',
      '  SELECT',
      `    toUnixTimestamp(${bucketExpr}) AS bucket_ts,`,
      `    ${breakdownSelect}distinct_id`,
      '  FROM events',
      `  WHERE ${whereClauses.join('\n    AND ')}`,
      ') AS ev',
      canon.join,
      `GROUP BY bucket_ts${groupByExtra}`,
      'ORDER BY bucket_ts',
    ].join('\n');
    return { eventName: event.name, sql, params, settings: canon.settings };
  }

  const sql = [
    'SELECT',
    `  toUnixTimestamp(${bucketExpr}) AS bucket_ts,`,
    `  ${breakdownSelect}${totalExpr()} AS value`,
    'FROM events',
    `WHERE ${whereClauses.join('\n  AND ')}`,
    `GROUP BY bucket_ts${groupByExtra}`,
    'ORDER BY bucket_ts',
  ].join('\n');

  return { eventName: event.name, sql, params };
}

/**
 * Compiles a validated {@link InsightsQuery} into parameterized ClickHouse SQL (contracts §14).
 * Pure and side-effect-free: it never talks to ClickHouse itself (see AnalyticsService for
 * execution + the 2-phase breakdown orchestration).
 */
export function compileInsightsQuery(
  query: InsightsQuery,
  projectId: string,
  cohort?: CohortPredicate,
): CompiledInsightsQuery {
  const bucketExpr = BUCKET_EXPR[query.interval];
  const buckets = buildBucketGrid(query.date_range.from, query.date_range.to, query.interval);
  const seriesQueries = query.events.map((event) =>
    compileEventSeriesQuery(query, projectId, event, bucketExpr, cohort),
  );
  const topBreakdownValuesQuery = query.breakdown
    ? compileTopBreakdownValuesQuery(query, projectId, cohort)
    : undefined;

  return {
    buckets,
    hasBreakdown: query.breakdown !== undefined,
    topBreakdownValuesQuery,
    seriesQueries,
  };
}
