import { toChDateTime64 } from '../../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from './bucket-grid';
import type { FilterValue, InsightsFilter } from '../queries/insights/insights-query.schema';
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
  namePrefix = 'filter',
): string {
  if (filter.target === 'profile') {
    return compileProfileFilter(filter, index, params, namePrefix);
  }

  const keyParam = `${namePrefix}Key${index}`;
  const valueParam = `${namePrefix}Val${index}`;
  const { expr } = resolveProperty(filter.property, keyParam, params);

  switch (filter.op) {
    case 'is_set':
      return `${expr} != ''`;
    case 'is_not_set':
      return `${expr} = ''`;
    case 'contains': {
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
      params[valueParam] = paramValueFor(value);
      return `${castTo(expr, type)} ${COMPARISON_OP[filter.op]} {${valueParam}:${type}}`;
    }
  }
}

/**
 * Compiles a `target: 'profile'` filter (RevenueCat spec §4.5 amendment) into a `distinct_id
 * IN (...)` subquery over `analytics.user_profiles` — structurally identical to a compiled cohort
 * predicate (see {@link CohortPredicate} / {@link applyCohortPredicate}), and using the SAME bare
 * `distinct_id` (no table alias) so it drops into every existing host query unmodified: some
 * (funnels/retention/insights) already AND-join a bare `distinct_id IN (...)` cohort predicate into
 * this exact WHERE-clause list, and others (engagement/click-heatmap/histogram) already resolve a
 * `property: 'distinct_id'` event filter to the same bare identifier via `resolveProperty`'s
 * whitelist — so it's already proven safe in every one of these query shapes.
 *
 * `FINAL` selects the current (`ReplacingMergeTree`-deduplicated) version of each profile row.
 *
 * PRECONDITION: the host query already binds `{projectId:UUID}` — every current call site of
 * `compileFilterClauses` does (retention/engagement/click-heatmap/histogram/insights/funnels
 * compilers and analytics.service.ts all bind it for their own `project_id` scoping).
 *
 * LIMITATION: matches on the event's `distinct_id`, i.e. the identity active when the event was
 * recorded. An anonymous user's pre-identify events (still tagged with their old anon
 * `distinct_id`) won't match a profile filter even if that person is identified later in the
 * queried range — the same limitation `applyCohortPredicate`'s cohort subqueries have.
 */
function compileProfileFilter(
  filter: InsightsFilter,
  index: number,
  params: Record<string, unknown>,
  namePrefix: string,
): string {
  const keyParam = `${namePrefix}Key${index}`;
  const valueParam = `${namePrefix}Val${index}`;
  params[keyParam] = filter.property;
  const expr = `JSONExtractString(toJSONString(properties), {${keyParam}:String})`;
  const predicate = profilePropertyPredicate(expr, filter.op, filter.value, valueParam, params);

  return `distinct_id IN (SELECT distinct_id FROM user_profiles FINAL WHERE project_id = {projectId:UUID} AND ${predicate})`;
}

/**
 * The op -> SQL predicate mapping for a profile property, extracted out of {@link
 * compileProfileFilter} so a future profile-property predicate compiler (Task 10: cohort
 * profile-property conditions) can reuse it against its own already-resolved `expr`/param names
 * instead of duplicating this switch.
 */
export function profilePropertyPredicate(
  expr: string,
  op: InsightsFilter['op'],
  value: FilterValue | undefined,
  valueParam: string,
  params: Record<string, unknown>,
): string {
  switch (op) {
    case 'is_set':
      return `${expr} != ''`;
    case 'is_not_set':
      return `${expr} = ''`;
    case 'contains':
      params[valueParam] = String(value);
      return `position(${expr}, {${valueParam}:String}) > 0`;
    case 'eq':
    case 'neq':
    case 'gt':
    case 'lt': {
      // The §14 refine on insightsFilterSchema guarantees `value` is defined for these ops.
      const v = value as FilterValue;
      const type = paramTypeFor(v);
      params[valueParam] = paramValueFor(v);
      return `${castTo(expr, type)} ${COMPARISON_OP[op]} {${valueParam}:${type}}`;
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
  namePrefix = 'filter',
): string[] {
  return filters.map((filter, index) =>
    compileFilter(filter, indexOffset + index, params, namePrefix),
  );
}

/**
 * A compiled cohort filter (contracts §16): a `distinct_id`-producing subquery plus its (uniquely
 * prefixed) bound params. Structurally matches `CohortsService.resolveCohortPredicate`'s output.
 */
export interface CohortPredicate {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * AND-joins a compiled cohort's `distinct_id IN (<subquery>)` predicate into a WHERE-clause list,
 * merging its bound params (contracts §16 `cohort_id` filter). Fully parameterized — the cohort
 * subquery and every value inside it are bound params (cohort param names are prefixed so they can
 * never collide with the host query's). A no-op when no cohort is set.
 */
export function applyCohortPredicate(
  whereClauses: string[],
  params: Record<string, unknown>,
  cohort: CohortPredicate | undefined,
): void {
  if (!cohort) return;
  Object.assign(params, cohort.params);
  whereClauses.push(`distinct_id IN (\n${cohort.sql}\n)`);
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
