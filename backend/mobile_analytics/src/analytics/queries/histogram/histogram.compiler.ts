import { compileDateRange, compileFilterClauses } from '../../support/filter-compiler';
import { resolveProperty } from '../../support/property-resolver';
import type { HistogramQuery } from './histogram.schema';

/**
 * Histogram compiler (contracts §19). Buckets a numeric `property` of a matching `event` (in a date
 * range, plus §14 filters) into an adaptive ClickHouse `histogram(bins)(...)`, alongside `count()`,
 * `min()`, `max()`, `avg()`, `quantile(0.5)`, `quantile(0.9)` of the same value.
 *
 * SECURITY: `event` is bound as `{event:String}`. `property` resolves through {@link resolveProperty}
 * — a whitelisted column or a bound `{histProp:String}` custom-property key — exactly the injection
 * doctrine used everywhere else in this module; it is never interpolated. Filters are compiled via
 * the shared {@link compileFilterClauses} (bound). `bins` is OUR validated integer (schema-clamped
 * 2..50) — it is embedded as a literal because ClickHouse's `histogram(N)(...)` requires `N` as a
 * literal parameter to the aggregate function, not a bound query param; it can never carry
 * caller-controlled text since the schema already coerced it to an `int` in `[2,50]`.
 */

export interface CompiledHistogramQuery {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Compiles a validated {@link HistogramQuery} into one fully-parameterized ClickHouse query (contracts
 * §19). Pure: it never touches ClickHouse. The inner subquery extracts+casts the value expression as
 * `toFloat64OrNull(...)` (safe for both a whitelisted string column and a custom JSON property, which
 * `resolveProperty` always surfaces as a String-typed expression) and the outer WHERE drops
 * null/non-finite values before they reach the aggregates.
 */
export function compileHistogramQuery(
  query: HistogramQuery,
  projectId: string,
): CompiledHistogramQuery {
  const params: Record<string, unknown> = {
    projectId,
    event: query.event,
    ...compileDateRange(query.date_range.from, query.date_range.to),
  };

  const { expr } = resolveProperty(query.property, 'histProp', params);
  const valueExpr = `toFloat64OrNull(${expr})`;

  const whereClauses = [
    'project_id = {projectId:UUID}',
    'event = {event:String}',
    'timestamp >= {from:DateTime64}',
    'timestamp < {toExclusive:DateTime64}',
    ...compileFilterClauses(query.filters, params),
  ];

  const sql = [
    'SELECT',
    `  histogram(${query.bins})(value) AS buckets,`,
    '  count() AS cnt,',
    '  min(value) AS mn,',
    '  max(value) AS mx,',
    '  avg(value) AS avgVal,',
    '  quantile(0.5)(value) AS p50,',
    '  quantile(0.9)(value) AS p90',
    'FROM (',
    `  SELECT ${valueExpr} AS value`,
    '  FROM events',
    `  WHERE ${whereClauses.join('\n    AND ')}`,
    ')',
    'WHERE value IS NOT NULL AND isFinite(value)',
  ].join('\n');

  return { sql, params };
}
