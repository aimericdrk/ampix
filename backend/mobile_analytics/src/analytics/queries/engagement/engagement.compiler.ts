import type { ClickHouseSettings } from '@clickhouse/client';
import { toChDateTime64 } from '../../../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from '../../support/bucket-grid';
import type { EngagementMetric } from '../../analytics.types';
import type { EngagementInterval } from './engagement.schema';
import { compileFilterClauses } from '../../support/filter-compiler';
import { canonicalization } from '../../support/identity';
import { CLIENT_EVENTS_ONLY } from '../../support/property-resolver';
import type { InsightsFilter } from '../insights/insights-query.schema';

/**
 * Engagement metrics compiler (contracts §19): DAU/WAU/MAU (per interval), stickiness (DAU/MAU) and
 * new-vs-returning, ALL counted by the §17 canonical `uid` so an anon→identified user is one person.
 *
 * SECURITY: the only dynamic values are the `{projectId:UUID}` / date-range `query_params` and OUR
 * OWN frozen `toStartOf*` bucket-function constant (selected by the validated interval enum, never
 * interpolated from raw input). `uid` comes from the shared injection-safe {@link canonicalization}
 * helper.
 *
 * DEVICE EVENTS ONLY (see CLIENT_EVENTS_ONLY). "Active" here is a claim about a person opening the
 * app, so a backend writing about someone cannot make them active — nor new, nor returning. On a
 * project whose backend emits an event per recipient this was the whole number: 15,484 "daily
 * active users" against 3 devices. The all-time `per_user` first-seen scan is filtered too, so a
 * user's "new" bucket is the day their DEVICE first appeared, not the day a backend first mentioned
 * them.
 *
 * Stickiness note: MAU is taken as the distinct canonical users active over the WHOLE queried range
 * (a common "monthly active over the selected period" simplification), and stickiness per bucket is
 * `active_in_bucket / MAU_range`. For a ~30-day range at `interval=day` this is exactly the classic
 * DAU/MAU ratio; it is exact and avoids a per-bucket rolling window. Stated in the report.
 */

const MS_PER_DAY = 86_400_000;

/** `toStartOf*` bucket fn selected by the validated interval enum — OUR OWN constants, never input. */
const ENGAGEMENT_BUCKET_FN: Readonly<Record<EngagementInterval, string>> = Object.freeze({
  day: 'toStartOfDay',
  week: 'toMonday',
  month: 'toStartOfMonth',
});

/** The metric label surfaced per interval (contracts §19). */
export const ENGAGEMENT_METRIC: Readonly<Record<EngagementInterval, EngagementMetric>> = Object.freeze({
  day: 'dau',
  week: 'wau',
  month: 'mau',
});

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}

export interface CompiledEngagement {
  /** Per in-range bucket: `{ bucket_ts, new_users, returning_users }` (active = new + returning). */
  newReturningQuery: CompiledQuery;
  /** One scalar row `{ mau }`: distinct canonical users active over the whole range. */
  rangeActiveQuery: CompiledQuery;
  /** Every canonicalized query MUST run with `join_use_nulls=1` (contracts §17). */
  settings: ClickHouseSettings;
}

/**
 * Compiles the two fully-parameterized, canonicalized ClickHouse queries backing the engagement
 * response (contracts §19). Pure: it never touches ClickHouse. The zero-fill grid + ratio math live
 * in V2AnalyticsService.
 */
export function compileEngagement(
  projectId: string,
  from: string,
  to: string,
  interval: EngagementInterval,
  filters: InsightsFilter[] = [],
): CompiledEngagement {
  const canon = canonicalization('e.distinct_id');
  const bucketFn = ENGAGEMENT_BUCKET_FN[interval];
  const params: Record<string, unknown> = {
    projectId,
    from: toChDateTime64(parseDateOnlyUTC(from)),
    toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
  };
  // feat-02 §3.4/T2: the optional global filters AND-join onto the "active in bucket"/range-MAU
  // event sets (below), never onto `per_user`'s all-time first-seen computation — a user's true
  // first-ever event still decides new-vs-returning; the filter only narrows WHICH active users are
  // counted. `params` is shared by both queries below (same object), matching this compiler's
  // existing precedent (`newReturningQuery`/`rangeActiveQuery` already share one `params`).
  const filterClauses = compileFilterClauses(filters, params);

  // `per_user`: each canonical user's first-ever event (over ALL project history) → decides "new"
  // (first-seen bucket == this bucket) vs "returning" (first-seen before). Every active user is one
  // or the other, so new + returning == active for the bucket.
  const newReturningSql = [
    `WITH ${canon.cte},`,
    '  per_user AS (',
    '    SELECT',
    `      ${canon.uid} AS uid,`,
    '      min(e.timestamp) AS first_ts',
    '    FROM events AS e',
    `    ${canon.join}`,
    `    WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY}`,
    '    GROUP BY uid',
    '  )',
    'SELECT',
    '  toUnixTimestamp(bucket_start) AS bucket_ts,',
    `  uniqExactIf(uid, ${bucketFn}(first_ts) = bucket_start) AS new_users,`,
    `  uniqExactIf(uid, ${bucketFn}(first_ts) < bucket_start) AS returning_users`,
    'FROM (',
    '  SELECT ev.bucket_start AS bucket_start, ev.uid AS uid, pu.first_ts AS first_ts',
    '  FROM (',
    '    SELECT',
    `      ${bucketFn}(e.timestamp) AS bucket_start,`,
    `      ${canon.uid} AS uid`,
    '    FROM events AS e',
    `    ${canon.join}`,
    `    WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY}`,
    '      AND e.timestamp >= {from:DateTime64}',
    '      AND e.timestamp < {toExclusive:DateTime64}',
    ...filterClauses.map((clause) => `      AND ${clause}`),
    '  ) AS ev',
    '  INNER JOIN per_user AS pu ON pu.uid = ev.uid',
    ')',
    'GROUP BY bucket_start',
    'ORDER BY bucket_start',
  ].join('\n');

  // Range-wide MAU: distinct canonical users active anywhere in [from, to].
  const rangeActiveSql = [
    `WITH ${canon.cte}`,
    `SELECT uniqExact(${canon.uid}) AS mau`,
    'FROM events AS e',
    `${canon.join}`,
    `WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY}`,
    '  AND e.timestamp >= {from:DateTime64}',
    '  AND e.timestamp < {toExclusive:DateTime64}',
    ...filterClauses.map((clause) => `  AND ${clause}`),
  ].join('\n');

  return {
    newReturningQuery: { sql: newReturningSql, params },
    rangeActiveQuery: { sql: rangeActiveSql, params },
    settings: canon.settings,
  };
}
