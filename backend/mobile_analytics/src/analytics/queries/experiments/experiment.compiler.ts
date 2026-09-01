import type { ClickHouseSettings } from '@clickhouse/client';
import { toChDateTime64 } from '../../../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from '../../support/bucket-grid';
import {
  applyCohortPredicate,
  compileFilterClauses,
  type CohortPredicate,
} from '../../support/filter-compiler';
import { canonicalization } from '../../support/identity';
import { resolveProperty } from '../../support/property-resolver';
import type { ExperimentQuery } from './experiment.schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CompiledExperimentQuery {
  sql: string;
  params: Record<string, unknown>;
  /** REQUIRED by the caller: the canonicalizing LEFT JOINs need `join_use_nulls=1`. */
  settings: ClickHouseSettings;
}

/**
 * Compiles a validated {@link ExperimentQuery} into one fully-parameterized ClickHouse query. Pure:
 * it never touches ClickHouse.
 *
 * Shape — two CTEs and a join:
 *
 *   exposures — one row per participant: their canonical id (§17, so an anon→identified user is one
 *     participant and not two), the variant they were FIRST exposed under, and that first
 *     exposure's timestamp. `argMin(variant, timestamp)` and not "their latest variant": a
 *     mid-test reassignment must not move someone between arms retroactively, taking their
 *     already-recorded conversion with them.
 *   converted — the participants who then fired the goal event strictly AFTER their exposure and
 *     within `conversion_window_days` of it. An INNER JOIN back onto `exposures` is what makes that
 *     window per-user; a shared absolute window would credit a conversion that happened before the
 *     user was ever exposed to the test.
 *
 * The outer query counts each arm and its converters. Goal events are scanned over an EXTENDED
 * window (`goalToExclusive` = range end + the conversion window) so a user exposed on the final day
 * of the range still gets their full window to convert in — otherwise every experiment's most
 * recent arm would look artificially bad purely because the query stopped watching.
 *
 * Users whose variant is empty are dropped (`HAVING variant != ''`): they fired the exposure event
 * carrying no assignment, so they belong to no arm and counting them would dilute one.
 *
 * SECURITY: every event name, property key, filter value and the conversion window is a bound query
 * param. The only non-param SQL text is our own structural constants and the canonicalization
 * helper's fixed fragments — `variant_property` reaches the SQL only through `resolveProperty`
 * (a whitelisted column identifier, or a `{variantKey:String}`-bound JSONExtract).
 */
export function compileExperimentQuery(
  query: ExperimentQuery,
  projectId: string,
  cohort?: CohortPredicate,
): CompiledExperimentQuery {
  // Two independent canonicalizations: the exposure scan aliases events as `e`, the goal scan as
  // `g`. Each CTE is its own scope, so both may name their alias table `aliases`.
  const exposureCanon = canonicalization('e.distinct_id');
  const goalCanon = canonicalization('g.distinct_id');

  const fromMs = parseDateOnlyUTC(query.date_range.from);
  const toExclusiveMs = parseDateOnlyUTC(query.date_range.to) + MS_PER_DAY;

  const params: Record<string, unknown> = {
    projectId,
    exposureEvent: query.exposure_event,
    goalEvent: query.goal_event,
    from: toChDateTime64(fromMs),
    toExclusive: toChDateTime64(toExclusiveMs),
    goalToExclusive: toChDateTime64(toExclusiveMs + query.conversion_window_days * MS_PER_DAY),
    conversionWindowDays: query.conversion_window_days,
  };

  // Exposure and goal filters share one SQL string, so their generated param names must not
  // collide: the goal filters are offset past the exposure filters.
  const exposureFilterClauses = compileFilterClauses(query.exposure_filters, params, 0);
  const goalFilterClauses = compileFilterClauses(
    query.goal_filters,
    params,
    query.exposure_filters.length,
  );

  // §16 cohort_id: restricts WHO is a participant. Applied to the exposure scan only — the goal
  // scan is already limited to those users by its INNER JOIN onto `exposures`.
  const cohortClauses: string[] = [];
  applyCohortPredicate(cohortClauses, params, cohort);

  const exposureWhere = [
    'e.project_id = {projectId:UUID}',
    'e.event = {exposureEvent:String}',
    'e.timestamp >= {from:DateTime64}',
    'e.timestamp < {toExclusive:DateTime64}',
    ...exposureFilterClauses,
    ...cohortClauses,
  ];

  const goalWhere = [
    'g.project_id = {projectId:UUID}',
    'g.event = {goalEvent:String}',
    'g.timestamp >= {from:DateTime64}',
    'g.timestamp < {goalToExclusive:DateTime64}',
    ...goalFilterClauses,
  ];

  // Where the variant label comes from decides the SHAPE of the query, not just an expression:
  //
  //  - `event`   — the label rides on the exposure event, so it is aggregated inside the exposure
  //                scan with argMin and the arm is settled there.
  //  - `profile` — the label is a per-user fact written once at assignment time, so `user_profiles`
  //                is joined onto the FINISHED exposures CTE, keyed by the canonical id. Reading it
  //                inside the scan instead would mean joining on the output of the alias LEFT JOIN,
  //                which is both slower and needlessly fragile.
  params.variantKey = query.variant_property;
  const isProfileVariant = query.variant_target === 'profile';

  const exposuresCte = isProfileVariant
    ? `exposures_raw AS (
        SELECT ${exposureCanon.uid} AS uid, min(e.timestamp) AS exposed_at
        FROM events AS e
        ${exposureCanon.join}
        WHERE ${exposureWhere.join('\n          AND ')}
        GROUP BY uid
      ),
      exposures AS (
        SELECT r.uid AS uid, r.exposed_at AS exposed_at,
               JSONExtractString(toJSONString(up.properties), {variantKey:String}) AS variant
        FROM exposures_raw AS r
        LEFT JOIN (
          SELECT distinct_id, properties FROM user_profiles FINAL
          WHERE project_id = {projectId:UUID}
        ) AS up ON up.distinct_id = r.uid
        WHERE JSONExtractString(toJSONString(up.properties), {variantKey:String}) != ''
      )`
    : `exposures AS (
        SELECT
          ${exposureCanon.uid} AS uid,
          argMin(${resolveProperty(query.variant_property, 'variantKey', params).expr}, e.timestamp) AS variant,
          min(e.timestamp) AS exposed_at
        FROM events AS e
        ${exposureCanon.join}
        WHERE ${exposureWhere.join('\n          AND ')}
        GROUP BY uid
        HAVING variant != ''
      )`;

  const sql = `WITH ${exposureCanon.cte},
      ${exposuresCte},
      converted AS (
        SELECT x.uid AS uid, min(g.timestamp) AS converted_at
        FROM events AS g
        ${goalCanon.join}
        INNER JOIN exposures AS x ON ${goalCanon.uid} = x.uid
        WHERE ${goalWhere.join('\n          AND ')}
          AND g.timestamp > x.exposed_at
          AND g.timestamp <= x.exposed_at + toIntervalDay({conversionWindowDays:UInt16})
        GROUP BY x.uid
      )
    SELECT
      x.variant AS variant,
      count() AS exposed,
      -- join_use_nulls=1 (canon.settings) makes converted_at NULL, not epoch-zero, for a
      -- participant who never converted — so this counts converters and not everyone.
      countIf(c.converted_at IS NOT NULL) AS converted
    FROM exposures AS x
    LEFT JOIN converted AS c ON x.uid = c.uid
    GROUP BY variant
    ORDER BY exposed DESC, variant ASC`;

  return { sql, params, settings: exposureCanon.settings };
}
