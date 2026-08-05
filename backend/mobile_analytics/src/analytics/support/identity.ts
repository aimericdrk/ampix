import type { ClickHouseSettings } from '@clickhouse/client';

/**
 * Identity resolution (contracts §17) — the anonymous→identified read-side merge.
 *
 * A physical user is tracked anonymously first (events carry `distinct_id = anon_id`), then logs in
 * (events carry `distinct_id = userId`). On `identify()` the SDK emits a reserved `$identify` event
 * whose `distinct_id` is the new `userId` and which carries property `$anon_id` = the pre-login id
 * (contracts §4). `identity_mappings_mv` (infra/clickhouse/init.sql) projects those links into
 * `analytics.identity_mappings (project_id, anon_id, canonical_id, created_at)`. This module
 * canonicalizes each event's `distinct_id` at query time so the two id-spaces read as ONE user.
 *
 * INJECTION SAFETY: this helper introduces NO request-derived SQL text. Its only dynamic value is
 * the `{projectId:UUID}` param (already bound by every analytics query); `$identify` / `$anon_id`
 * are OUR fixed reserved constants and live ONLY in the MV DDL. The `distinctIdRef` argument below
 * is always one of our OWN compile-time constants (`e.distinct_id` / `ev.distinct_id`) chosen by
 * the compiling code — it is never derived from user input. So canonicalization is injection-safe
 * by construction; callers keep binding every user value as a `query_param` exactly as before.
 */

/**
 * The `aliases` CTE body (contracts §17): the latest canonical id per `anon_id` for one project
 * (`argMax(canonical_id, created_at)` collapses ReplacingMergeTree duplicates without `FINAL`).
 * Place it right after `WITH `. It references the host query's `{projectId:UUID}` param, so no new
 * binding is required.
 */
export const ALIASES_CTE = `aliases AS (
  SELECT project_id, anon_id, argMax(canonical_id, created_at) AS canonical_id
  FROM identity_mappings
  WHERE project_id = {projectId:UUID}
  GROUP BY project_id, anon_id
)`;

/**
 * REQUIRED ClickHouse settings for every canonicalized query. With the default `join_use_nulls=0`,
 * an unmatched LEFT JOIN fills `aliases.canonical_id` with '' (the String default), NOT NULL — so
 * `coalesce(aliases.canonical_id, …)` would wrongly yield '' for every already-identified user and
 * collapse them all into one empty-id bucket. `join_use_nulls=1` makes the unmatched cell NULL so
 * `coalesce` correctly falls through to the event's own `distinct_id`. (Verified against
 * clickhouse-server:24.8.)
 */
export const CANONICAL_JOIN_SETTINGS: ClickHouseSettings = { join_use_nulls: 1 };

export interface Canonicalization {
  /** The `aliases AS (…)` CTE body — place after `WITH ` (may be combined with other CTEs). */
  cte: string;
  /** `LEFT JOIN aliases …` attaching the alias row to each event row. */
  join: string;
  /** SQL expression evaluating to the canonical id for a row: the mapped user, else its own id. */
  uid: string;
  /** ClickHouse settings the query MUST run with (see {@link CANONICAL_JOIN_SETTINGS}). */
  settings: ClickHouseSettings;
}

/**
 * The single reusable canonicalization builder (contracts §17): the WITH-aliases CTE + LEFT JOIN
 * yielding `coalesce(aliases.canonical_id, <distinctIdRef>) AS uid`. `distinctIdRef` selects which
 * table/subquery the event `distinct_id` comes from — `e.distinct_id` when joining `events AS e`
 * directly (users explorer), `ev.distinct_id` when joining a wrapping subquery aliased `ev`
 * (insights `unique_users`). It is ALWAYS one of these fixed internal constants, never user input.
 */
export function canonicalization(distinctIdRef = 'e.distinct_id'): Canonicalization {
  return {
    cte: ALIASES_CTE,
    join: `LEFT JOIN aliases ON ${distinctIdRef} = aliases.anon_id`,
    uid: `coalesce(aliases.canonical_id, ${distinctIdRef})`,
    settings: CANONICAL_JOIN_SETTINGS,
  };
}

/**
 * Resolves a single requested id to its canonical id (contracts §17): if `{distinctId:String}` is
 * itself an `anon_id` in the alias map it returns the mapped `canonical_id`, else it returns ''
 * (argMax over zero rows) and the caller falls back to the requested id. Used by
 * `GET /users/:distinctId` so a profile requested by an anon_id that aliases to a user returns that
 * user's merged canonical profile. The requested id is bound as a param — never interpolated.
 */
export const RESOLVE_CANONICAL_ID_SQL = `SELECT argMax(canonical_id, created_at) AS canonical_id
FROM identity_mappings
WHERE project_id = {projectId:UUID}
  AND anon_id = {distinctId:String}`;
