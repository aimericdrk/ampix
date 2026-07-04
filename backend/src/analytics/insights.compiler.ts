import { BUCKET_EXPR, Bucket, buildBucketGrid } from './bucket-grid';
import {
  CohortPredicate,
  applyCohortPredicate,
  compileDateRange,
  compileFilterClauses,
} from './filter-compiler';
import type { Aggregation, InsightsEvent, InsightsQuery } from './insights-query.schema';
import { resolveProperty } from './property-resolver';

/** contracts §14: breakdown series are capped at the top 20 values. */
export const MAX_BREAKDOWN_VALUES = 20;

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}

export interface CompiledEventSeriesQuery extends CompiledQuery {
  eventName: string;
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

function aggregationExpr(aggregation: Aggregation): string {
  return aggregation === 'unique_users' ? 'uniqExact(distinct_id)' : 'count(DISTINCT insert_id)';
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

  const sql = [
    'SELECT',
    `  toUnixTimestamp(${bucketExpr}) AS bucket_ts,`,
    `  ${breakdownSelect}${aggregationExpr(event.aggregation)} AS value`,
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
