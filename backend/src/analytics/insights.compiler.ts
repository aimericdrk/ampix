import { toChDateTime64 } from '../clickhouse/clickhouse.service';
import { BUCKET_EXPR, Bucket, buildBucketGrid, parseDateOnlyUTC } from './bucket-grid';
import type {
  Aggregation,
  FilterValue,
  InsightsEvent,
  InsightsFilter,
  InsightsQuery,
} from './insights-query.schema';
import { resolveProperty } from './property-resolver';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

type ParamType = 'String' | 'Float64' | 'UInt8';

function paramTypeFor(value: FilterValue): ParamType {
  if (typeof value === 'number') return 'Float64';
  if (typeof value === 'boolean') return 'UInt8';
  return 'String';
}

function paramValueFor(value: FilterValue): string | number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * Casts a String-typed SQL expression (every whitelisted column and every JSONExtractString(...)
 * call is String-typed) so it can be compared against a non-String bound param without
 * ClickHouse raising "Illegal types of arguments". A no-op for String params.
 */
function castTo(expr: string, type: ParamType): string {
  if (type === 'Float64') return `toFloat64OrZero(${expr})`;
  if (type === 'UInt8') return `toUInt8OrZero(${expr})`;
  return expr;
}

const COMPARISON_OP: Record<'eq' | 'neq' | 'gt' | 'lt', string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  lt: '<',
};

/**
 * Compiles one `filters[]` entry into a SQL boolean expression, mutating `params`. Every property
 * key (when it's a custom, non-whitelisted property) and every value is bound as a query
 * parameter — never string-interpolated (contracts §14, SECURITY-CRITICAL).
 */
function compileFilter(
  filter: InsightsFilter,
  index: number,
  params: Record<string, unknown>,
): string {
  const { expr } = resolveProperty(filter.property, `filterKey${index}`, params);

  switch (filter.op) {
    case 'is_set':
      return `${expr} != ''`;
    case 'is_not_set':
      return `${expr} = ''`;
    case 'contains': {
      const valueParam = `filterVal${index}`;
      params[valueParam] = String(filter.value);
      return `position(${expr}, {${valueParam}:String}) > 0`;
    }
    case 'eq':
    case 'neq':
    case 'gt':
    case 'lt': {
      // The §14 refine on insightsFilterSchema guarantees `value` is defined for these ops.
      const value = filter.value as FilterValue;
      const type = paramTypeFor(value);
      const valueParam = `filterVal${index}`;
      params[valueParam] = paramValueFor(value);
      return `${castTo(expr, type)} ${COMPARISON_OP[filter.op]} {${valueParam}:${type}}`;
    }
  }
}

function compileFilterClauses(
  filters: InsightsFilter[],
  params: Record<string, unknown>,
): string[] {
  return filters.map((filter, index) => compileFilter(filter, index, params));
}

function aggregationExpr(aggregation: Aggregation): string {
  return aggregation === 'unique_users' ? 'uniqExact(distinct_id)' : 'count(DISTINCT insert_id)';
}

/** `timestamp >= {from:DateTime64} AND timestamp < {to+1day}` (contracts §14: inclusive dates). */
function dateRangeParams(query: InsightsQuery): { from: string; toExclusive: string } {
  const fromMs = parseDateOnlyUTC(query.date_range.from);
  const toExclusiveMs = parseDateOnlyUTC(query.date_range.to) + MS_PER_DAY;
  return { from: toChDateTime64(fromMs), toExclusive: toChDateTime64(toExclusiveMs) };
}

function compileTopBreakdownValuesQuery(query: InsightsQuery, projectId: string): CompiledQuery {
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
): CompiledInsightsQuery {
  const bucketExpr = BUCKET_EXPR[query.interval];
  const buckets = buildBucketGrid(query.date_range.from, query.date_range.to, query.interval);
  const seriesQueries = query.events.map((event) =>
    compileEventSeriesQuery(query, projectId, event, bucketExpr),
  );
  const topBreakdownValuesQuery = query.breakdown
    ? compileTopBreakdownValuesQuery(query, projectId)
    : undefined;

  return {
    buckets,
    hasBreakdown: query.breakdown !== undefined,
    topBreakdownValuesQuery,
    seriesQueries,
  };
}
