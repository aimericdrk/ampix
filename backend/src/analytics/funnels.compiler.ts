import {
  CohortPredicate,
  applyCohortPredicate,
  compileDateRange,
  compileFilterClauses,
} from './filter-compiler';
import type { FunnelOrder, FunnelsQuery } from './funnels.schema';
import { resolveProperty } from './property-resolver';

/** contracts §15: one funnel per breakdown value, top 10 by entry volume, rest folded to `$other`. */
export const MAX_FUNNEL_BREAKDOWN_VALUES = 10;

const SECONDS_PER_DAY = 86_400;

/**
 * `windowFunnel` ordering mode argument, selected by the validated `order` enum (contracts §15).
 * These are OUR OWN literal constants — never raw input — so embedding them in the parametric
 * position of `windowFunnel(...)` carries no injection risk. `strict_order` forbids other matching
 * events from interleaving between the steps (steps must be strictly consecutive in time).
 */
const FUNNEL_MODE_ARG: Readonly<Record<FunnelOrder, string>> = Object.freeze({
  any: '',
  strict_order: ", 'strict_order'",
});

export interface CompiledFunnelQuery {
  sql: string;
  params: Record<string, unknown>;
  /** Number of ordered steps — the outer query exposes `step_0 .. step_{stepCount-1}` counts. */
  stepCount: number;
  hasBreakdown: boolean;
}

/**
 * Compiles a validated {@link FunnelsQuery} into a single fully-parameterized ClickHouse query
 * (contracts §15). Pure: it never touches ClickHouse. The subquery runs `windowFunnel` per
 * `distinct_id` (and per breakdown value when set) to get each user's max reached level; the outer
 * query turns that into `countIf(level >= k+1)` per step.
 *
 * SECURITY: every step event name and every filter value/key is a bound param; the only non-param
 * SQL fragments are our own frozen structural constants (the mode arg) and JS-generated integers
 * (the `>= k+1` step thresholds, derived from the validated, bounded `steps.length`).
 */
export function compileFunnelQuery(
  query: FunnelsQuery,
  projectId: string,
  cohort?: CohortPredicate,
): CompiledFunnelQuery {
  const params: Record<string, unknown> = {
    projectId,
    windowSeconds: query.window_days * SECONDS_PER_DAY,
    stepEvents: query.steps.map((step) => step.event),
    ...compileDateRange(query.date_range.from, query.date_range.to),
  };

  // Each step -> one windowFunnel condition. Filters across steps share the SQL string, so their
  // param names must be globally unique: thread a running offset over all steps' filters.
  const conditions: string[] = [];
  let filterOffset = 0;
  query.steps.forEach((step, i) => {
    const eventParam = `step${i}Event`;
    params[eventParam] = step.event;
    const clauses = [
      `event = {${eventParam}:String}`,
      ...compileFilterClauses(step.filters, params, filterOffset),
    ];
    filterOffset += step.filters.length;
    conditions.push(clauses.length > 1 ? `(${clauses.join(' AND ')})` : clauses[0]);
  });

  const modeArg = FUNNEL_MODE_ARG[query.order];
  const hasBreakdown = query.breakdown !== undefined;

  let breakdownSelect = '';
  let innerGroupBy = 'distinct_id';
  let outerBreakdown = '';
  let outerGroupOrder = '';
  if (query.breakdown) {
    const { expr } = resolveProperty(query.breakdown.property, 'breakdownKey', params);
    breakdownSelect = `${expr} AS breakdown_value,\n    `;
    innerGroupBy = 'distinct_id, breakdown_value';
    outerBreakdown = 'breakdown_value,\n  ';
    outerGroupOrder = '\nGROUP BY breakdown_value\nORDER BY step_0 DESC';
  }

  const stepCounts = query.steps
    .map((_, k) => `countIf(level >= ${k + 1}) AS step_${k}`)
    .join(',\n  ');

  // §16 cohort_id filter: AND-join `distinct_id IN (<cohort subquery>)` into the inner scan.
  const cohortClauses: string[] = [];
  applyCohortPredicate(cohortClauses, params, cohort);
  const cohortClause = cohortClauses.length > 0 ? `\n    AND ${cohortClauses[0]}` : '';

  const sql = [
    'SELECT',
    `  ${outerBreakdown}${stepCounts}`,
    'FROM (',
    '  SELECT',
    `    ${breakdownSelect}windowFunnel({windowSeconds:UInt32}${modeArg})(`,
    // DateTime (second resolution) makes windowFunnel's window unambiguously seconds — window_days
    // * 86400 — with no DateTime64 ms-vs-seconds ambiguity.
    '      toDateTime(timestamp),',
    `      ${conditions.join(',\n      ')}`,
    '    ) AS level',
    '  FROM events',
    '  WHERE project_id = {projectId:UUID}',
    '    AND timestamp >= {from:DateTime64}',
    `    AND timestamp < {toExclusive:DateTime64}${cohortClause}`,
    '    AND event IN {stepEvents:Array(String)}',
    `  GROUP BY ${innerGroupBy}`,
    `)${outerGroupOrder}`,
  ].join('\n');

  return { sql, params, stepCount: query.steps.length, hasBreakdown };
}
