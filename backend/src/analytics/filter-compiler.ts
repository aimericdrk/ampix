import { toChDateTime64 } from '../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from './bucket-grid';
import type { FilterValue, InsightsFilter } from './insights-query.schema';
import { resolveProperty } from './property-resolver';

/**
 * Shared, injection-safe filter compiler (contracts §14/§15). Extracted from the Phase-3 insights
 * compiler so funnels/retention/flows (§15) reuse the *exact* same rules rather than duplicating
 * them: every property key resolves through {@link resolveProperty} (whitelist column or bound
 * `{key:String}` param) and every value is a bound query parameter — never string-interpolated.
 *
 * The `indexOffset` argument is what makes this safe to call more than once inside a single
 * compiled SQL statement (a funnel with per-step filters, a retention query with separate
 * born/return filters): each caller threads an offset so the generated param names
 * (`filterKey{n}` / `filterVal{n}`) stay globally unique within that one SQL string and never
 * collide across steps/clauses.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ParamType = 'String' | 'Float64' | 'UInt8';

export function paramTypeFor(value: FilterValue): ParamType {
  if (typeof value === 'number') return 'Float64';
  if (typeof value === 'boolean') return 'UInt8';
  return 'String';
}

export function paramValueFor(value: FilterValue): string | number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * Casts a String-typed SQL expression (every whitelisted column and every JSONExtractString(...)
 * call is String-typed) so it can be compared against a non-String bound param without ClickHouse
 * raising "Illegal types of arguments". A no-op for String params.
 */
export function castTo(expr: string, type: ParamType): string {
  if (type === 'Float64') return `toFloat64OrZero(${expr})`;
  if (type === 'UInt8') return `toUInt8OrZero(${expr})`;
  return expr;
}

export const COMPARISON_OP: Readonly<Record<'eq' | 'neq' | 'gt' | 'lt', string>> = Object.freeze({
  eq: '=',
  neq: '!=',
  gt: '>',
  lt: '<',
});

/**
 * Compiles one `filters[]` entry into a SQL boolean expression, mutating `params`. `index` is the
 * GLOBAL index used for this filter's param names (`filterKey{index}` / `filterVal{index}`) — the
 * caller is responsible for keeping it unique across every filter in the same SQL string.
 */
export function compileFilter(
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

/**
 * Compiles a list of filters into AND-joinable SQL clauses, mutating `params`. Param names are
 * indexed from `indexOffset` (default `0`, preserving the Phase-3 single-clause behavior), so
 * multiple filter groups in one SQL string (funnel steps, retention born/return) never collide.
 */
export function compileFilterClauses(
  filters: InsightsFilter[],
  params: Record<string, unknown>,
  indexOffset = 0,
): string[] {
  return filters.map((filter, index) => compileFilter(filter, indexOffset + index, params));
}

/**
 * `{ from, toExclusive }` for an inclusive-date range (contracts §14/§15): `timestamp >= {from}` and
 * `timestamp < {toExclusive}` where `toExclusive` is `to + 1 day` (so the whole `to` day is
 * included). Both are ClickHouse `DateTime64` literals ready to bind.
 */
export function compileDateRange(from: string, to: string): { from: string; toExclusive: string } {
  return {
    from: toChDateTime64(parseDateOnlyUTC(from)),
    toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
  };
}
