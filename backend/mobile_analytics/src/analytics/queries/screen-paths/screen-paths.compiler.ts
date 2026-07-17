import type { ClickHouseSettings } from '@clickhouse/client';
import { compileDateRange } from '../../support/filter-compiler';
import type { FlowUnitRow } from '../flows/flows.compiler';
import type { FlowUnit } from '../flows/flows.schema';
import { canonicalization } from '../../support/identity';
import type { ScreenPathsQuery } from './screen-paths.schema';

/**
 * Screen-paths compiler (contracts §19). Emits, per unit (session or user), the time-ordered
 * `$screen_name` sequence of `$screen_view` events plus a per-row `is_anchor` flag. The path
 * extraction / transition aggregation / top-N + `$other`/`$end` folding all reuse §15's pure
 * {@link buildFlowGraph} — the ONLY difference from flows is that nodes are the screen NAME (a
 * property) instead of the event name, and users are counted by the §17 canonical `uid`.
 *
 * SECURITY: `$screen_view` / `$screen_name` are OUR fixed reserved constants (contracts §4), SQL
 * literals — never bound from user input. The only caller-derived values (anchor screen, dates) are
 * bound `query_params`. `uid` comes from the shared, injection-safe {@link canonicalization} helper
 * (its only dynamic value is the `{projectId:UUID}` param the host query already binds).
 */

/** The screen-view autocapture event (contracts §4) — OUR reserved constant, an SQL literal. */
export const SCREEN_VIEW_EVENT = '$screen_view';
/** `$screen_name` is a reserved `$screen_view` property (contracts §4); extracted from the native
 *  JSON column via `toJSONString(properties)` first (see property-resolver's note). */
const SCREEN_NAME_EXPR = "JSONExtractString(toJSONString(e.properties), '$screen_name')";

export interface CompiledScreenPathQuery {
  sql: string;
  params: Record<string, unknown>;
  /** The canonicalizing LEFT JOIN needs `join_use_nulls=1` (contracts §17). */
  settings: ClickHouseSettings;
}

/**
 * Compiles a validated {@link ScreenPathsQuery} into one canonicalized, fully-parameterized query.
 * Pure. When `anchor_screen` is set, `is_anchor` flags each visit to that screen in SQL and only
 * units that visited it are kept (`HAVING max(is_anchor) = 1`); when omitted, `is_anchor` is `0`
 * here and {@link markEntryAnchors} flags each unit's entry screen after the rows are fetched.
 */
export function compileScreenPathQuery(
  query: ScreenPathsQuery,
  projectId: string,
): CompiledScreenPathQuery {
  const canon = canonicalization('e.distinct_id');
  const params: Record<string, unknown> = {
    projectId,
    ...compileDateRange(query.date_range.from, query.date_range.to),
  };

  // Unit key: a session splits by session_id; a user timeline splits by the canonical uid so an
  // anon→identified user reads as ONE timeline. Both are OUR OWN expressions selected by the
  // validated `unit` enum — never raw input.
  const unitColumn: Readonly<Record<FlowUnit, string>> = {
    session: 'e.session_id',
    user: canon.uid,
  };
  const unitExpr = unitColumn[query.unit];

  let isAnchorExpr = '0';
  let having = '';
  if (query.anchor_screen !== undefined) {
    params.anchorScreen = query.anchor_screen;
    isAnchorExpr = `${SCREEN_NAME_EXPR} = {anchorScreen:String}`;
    having = '\nHAVING max(is_anchor) = 1';
  }

  const whereClauses = [
    'e.project_id = {projectId:UUID}',
    `e.event = '${SCREEN_VIEW_EVENT}'`,
    'e.timestamp >= {from:DateTime64}',
    'e.timestamp < {toExclusive:DateTime64}',
    `${SCREEN_NAME_EXPR} != ''`,
  ];

  // §17 identity-correct per-user filter: the caller passes the canonical id + its aliased anon_ids
  // and we restrict to those exact RAW `e.distinct_id` values. The raw column is deliberately NOT
  // canonicalized here (mirrors the click-heatmap `distinct_ids` filter, contracts §17/§19), so a
  // user tracked anonymously then identified — whose screen views live under BOTH ids — is fully
  // captured. The list is bound as an Array(String) query_param, so it is injection-safe regardless
  // of the ids' contents.
  if (query.distinct_ids && query.distinct_ids.length > 0) {
    whereClauses.push('e.distinct_id IN {distinctIds:Array(String)}');
    params.distinctIds = query.distinct_ids;
  }

  const sql = [
    `WITH ${canon.cte}`,
    'SELECT',
    '  unit_id,',
    '  any(did) AS did,',
    '  arraySort(x -> x.1, groupArray((ms, screen, is_anchor))) AS seq',
    'FROM (',
    '  SELECT',
    `    ${unitExpr} AS unit_id,`,
    `    ${canon.uid} AS did,`,
    '    toUnixTimestamp64Milli(e.timestamp) AS ms,',
    `    ${SCREEN_NAME_EXPR} AS screen,`,
    `    toUInt8(${isAnchorExpr}) AS is_anchor`,
    '  FROM events AS e',
    `  ${canon.join}`,
    `  WHERE ${whereClauses.join('\n    AND ')}`,
    ')',
    `GROUP BY unit_id${having}`,
  ].join('\n');

  return { sql, params, settings: canon.settings };
}

/**
 * Flags each unit's FIRST (entry) screen as the anchor for the no-`anchor_screen` mode (contracts
 * §19: "start from the top entry screens"). Each `seq` is already time-ordered, so index 0 is the
 * entry visit and every later row is a non-anchor — {@link buildFlowGraph} then walks one path per
 * unit forward from its entry screen. Pure; leaves the compiled SQL free of post-processing.
 */
export function markEntryAnchors(rows: FlowUnitRow[]): FlowUnitRow[] {
  return rows.map((row) => ({
    did: row.did,
    seq: row.seq.map(
      (tuple, i) => [tuple[0], tuple[1], i === 0 ? 1 : 0] as [unknown, string, number],
    ),
  }));
}
