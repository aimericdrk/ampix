import { toChDateTime64 } from '../clickhouse/clickhouse.service';
import { compileFilter, compileFilterClauses } from '../analytics/filter-compiler';
import type { InsightsFilter } from '../analytics/insights-query.schema';
import type {
  BehaviorCondition,
  CohortCondition,
  CohortCountOp,
  CohortDefinition,
  DidNotCondition,
  PropertyCondition,
} from './cohort.schema';

/**
 * Injection-safe cohort engine (contracts §16). Compiles a validated {@link CohortDefinition} into a
 * SINGLE parameterized ClickHouse subquery that PRODUCES `distinct_id` rows — never a materialized id
 * list spliced into SQL. The subquery is used as `distinct_id IN (<subquery>)` (preview count / sample,
 * and the optional §14/§15 `cohort_id` filter).
 *
 * SECURITY: every event name is bound as a param; every property reference resolves through the shared
 * filter compiler (`resolveProperty` — whitelist column or bound `{key:String}` param); every value is a
 * bound param. The ONLY non-param SQL fragments are our own frozen structural constants (the count-op
 * map, the `INTERSECT`/`UNION DISTINCT` combinator) and the fixed `cohortProjectId` scope. All generated
 * param names are prefixed `cohort…`/`c{index}…` so they can never collide with a host query's params
 * when this subquery is AND-joined into an insights/funnel/retention query.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `HAVING count() {op} {n}` operator, selected by the validated `op` enum — never raw input. */
const COHORT_COUNT_SQL_OP: Readonly<Record<CohortCountOp, string>> = Object.freeze({
  gte: '>=',
  gt: '>',
  lte: '<=',
  lt: '<',
  eq: '=',
});

/** Set combinator, selected by the validated `match` enum — never raw input. */
const MATCH_COMBINATOR: Readonly<Record<'all' | 'any', string>> = Object.freeze({
  all: 'INTERSECT',
  any: 'UNION DISTINCT',
});

export interface CompiledCohort {
  /** A `SELECT distinct_id …` subquery (or set-combination of them). Distinct rows. */
  sql: string;
  params: Record<string, unknown>;
}

export interface CompileCohortOptions {
  /** Wall-clock "now" for the `within_days` windows (contracts §16 "last D days"). Default `Date.now()`. */
  now?: number;
  /** Bound-param name for the project scope (default `cohortProjectId`). */
  projectIdParam?: string;
}

const PROJECT_SCOPE_DEFAULT = 'cohortProjectId';

function sinceLiteral(now: number, withinDays: number): string {
  return toChDateTime64(now - withinDays * MS_PER_DAY);
}

/** behavior → users who did the event `{op} {count}` times in the window (with §14 filters). */
function compileBehavior(
  cond: BehaviorCondition,
  index: number,
  params: Record<string, unknown>,
  now: number,
  scope: string,
): string {
  const eventParam = `c${index}Event`;
  const sinceParam = `c${index}Since`;
  const countParam = `c${index}Count`;
  params[eventParam] = cond.event;
  params[sinceParam] = sinceLiteral(now, cond.within_days);
  params[countParam] = cond.count;

  const clauses = [
    `project_id = {${scope}:UUID}`,
    `event = {${eventParam}:String}`,
    `timestamp >= {${sinceParam}:DateTime64}`,
    ...compileFilterClauses(cond.filters, params, 0, `c${index}f`),
  ];
  return [
    'SELECT distinct_id',
    'FROM events',
    `WHERE ${clauses.join('\n  AND ')}`,
    'GROUP BY distinct_id',
    `HAVING count(DISTINCT insert_id) ${COHORT_COUNT_SQL_OP[cond.op]} {${countParam}:UInt64}`,
  ].join('\n');
}

/** did_not → users (with any event) who performed the event 0 times in the window. */
function compileDidNot(
  cond: DidNotCondition,
  index: number,
  params: Record<string, unknown>,
  now: number,
  scope: string,
): string {
  const eventParam = `c${index}Event`;
  const sinceParam = `c${index}Since`;
  params[eventParam] = cond.event;
  params[sinceParam] = sinceLiteral(now, cond.within_days);

  const didPredicate = [
    `event = {${eventParam}:String}`,
    `timestamp >= {${sinceParam}:DateTime64}`,
    ...compileFilterClauses(cond.filters, params, 0, `c${index}f`),
  ].join(' AND ');
  return [
    'SELECT distinct_id',
    'FROM events',
    `WHERE project_id = {${scope}:UUID}`,
    'GROUP BY distinct_id',
    `HAVING countIf(${didPredicate}) = 0`,
  ].join('\n');
}

/** property → users with at least one event matching the §14 filter (via `resolveProperty`). */
function compileProperty(
  cond: PropertyCondition,
  index: number,
  params: Record<string, unknown>,
  scope: string,
): string {
  // A property condition is structurally a §14 filter; reuse the shared, injection-safe compiler.
  const clause = compileFilter(cond as InsightsFilter, 0, params, `c${index}p`);
  return [
    'SELECT distinct_id',
    'FROM events',
    `WHERE project_id = {${scope}:UUID}`,
    `  AND ${clause}`,
    'GROUP BY distinct_id',
  ].join('\n');
}

function compileCondition(
  cond: CohortCondition,
  index: number,
  params: Record<string, unknown>,
  now: number,
  scope: string,
): string {
  switch (cond.type) {
    case 'behavior':
      return compileBehavior(cond, index, params, now, scope);
    case 'did_not':
      return compileDidNot(cond, index, params, now, scope);
    case 'property':
      return compileProperty(cond, index, params, scope);
  }
}

/**
 * Compiles a validated cohort definition into a parameterized `distinct_id`-producing subquery.
 * Pure and side-effect-free (never touches ClickHouse). `all` intersects the per-condition id-sets,
 * `any` unions them.
 */
export function compileCohort(
  definition: CohortDefinition,
  projectId: string,
  options: CompileCohortOptions = {},
): CompiledCohort {
  const now = options.now ?? Date.now();
  const scope = options.projectIdParam ?? PROJECT_SCOPE_DEFAULT;
  const params: Record<string, unknown> = { [scope]: projectId };

  const setSqls = definition.conditions.map((cond, index) =>
    compileCondition(cond, index, params, now, scope),
  );

  const sql =
    setSqls.length === 1
      ? setSqls[0]
      : setSqls.map((s) => `(\n${s}\n)`).join(`\n${MATCH_COMBINATOR[definition.match]}\n`);

  return { sql, params };
}
