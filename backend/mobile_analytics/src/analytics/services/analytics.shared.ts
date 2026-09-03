import { toChDateTime64 } from '../../clickhouse/clickhouse.service';
import type { Bucket } from '../support/bucket-grid';

/** contracts §14: metadata endpoints scan "distinct event names / property keys, last 30 days". */
export const META_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** contracts §14: `/sessions/summary` reads `$session_end` events' `$duration_ms` property. Both
 *  are OUR OWN fixed reserved-name constants (contracts §4), never user input, so — matching how
 *  `infra/clickhouse/init.sql`'s `daily_sessions_mv` does it — they're embedded as SQL literals
 *  rather than bound params; only caller-supplied values ever need binding. */
export const SESSION_END_EVENT = '$session_end';
export const DURATION_MS_EXPR = "JSONExtractFloat(toJSONString(properties), '$duration_ms')";

/** contracts §19: `/metrics/revenue` reads `$in_app_purchase` events' `$price`/`$product_id`
 *  properties. Same doctrine as `SESSION_END_EVENT`/`DURATION_MS_EXPR` above — these are OUR OWN
 *  fixed reserved-name constants (contracts §4), never user input, so embedded as SQL literals;
 *  only caller-supplied values (projectId, date range) are ever bound as params. */
export const IN_APP_PURCHASE_EVENT = '$in_app_purchase';
export const PRICE_EXPR = "JSONExtractFloat(toJSONString(properties), '$price')";
export const PRODUCT_ID_EXPR = "JSONExtractString(toJSONString(properties), '$product_id')";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `GET /users` search whitelist (contracts §14): profile string properties a `search` term may
 * match, in addition to the canonical id and its aliased anon_ids. These are OUR OWN fixed
 * constants embedded as SQL literals inside `JSONExtractString(toJSONString(up.properties), '<key>')`
 * — never caller input — matching the injection-safety doctrine in `property-resolver.ts`. The
 * search VALUE itself is always the bound `{search:String}` param.
 */
export const USER_SEARCH_PROFILE_KEYS = ['name', 'email', 'username', '$name', '$email'] as const;

/**
 * Profile keys `GET /users` reads an email from, in priority order — the same spellings the
 * dashboard's `user-identity.ts` falls back through, so the list, the profile header and the
 * "identified" filter all agree on whether a person has an email. Same injection doctrine as
 * `USER_SEARCH_PROFILE_KEYS`: OUR OWN fixed constants, embedded as SQL literals, never caller input.
 */
export const USER_EMAIL_PROFILE_KEYS = ['email', '$email'] as const;

/**
 * Profile keys `GET /users` reads a phone number from, in priority order. Apps set profile
 * properties free-form (`people.set({...})`), so there is no single canonical spelling — accept the
 * conventional ones rather than forcing one on every integrator. Same injection doctrine as
 * `USER_SEARCH_PROFILE_KEYS`: OUR OWN fixed constants, embedded as SQL literals, never caller input.
 */
export const USER_PHONE_PROFILE_KEYS = ['phone', '$phone', 'phone_number', 'phoneNumber'] as const;

/**
 * SQL for "the first non-empty value among `keys` on the joined `up.properties`", as a
 * Nullable(String) that is NULL when the profile sets none of them. `keys` must always be our own
 * constants (see the doctrine note above) — never caller input.
 */
export function firstProfileStringExpr(keys: readonly string[]): string {
  const parts = keys.map(
    (key) => `nullIf(JSONExtractString(toJSONString(up.properties), '${key}'), '')`,
  );
  return parts.length === 1 ? parts[0] : `coalesce(${parts.join(', ')})`;
}

export function sinceParam(): string {
  return toChDateTime64(Date.now() - META_LOOKBACK_MS);
}

/** Reindexes ClickHouse's (sparse) grouped rows onto the full zero-filled bucket grid. Used by
 *  `InsightsQueryService` for per-series buckets. */
export function zeroFill(
  buckets: Bucket[],
  rows: { bucket_ts: string | number; value: string | number }[],
): { t: string; value: number }[] {
  const byTs = new Map<number, number>();
  for (const row of rows) {
    byTs.set(Number(row.bucket_ts), Number(row.value));
  }
  return buckets.map((bucket) => ({ t: bucket.t, value: byTs.get(bucket.ts) ?? 0 }));
}

/**
 * The one thing the audience READ path needs from the hide/erase write surface: which canonical
 * ids this project has hidden (§17 soft remove). Declared as a narrow interface rather than
 * importing `UserAdminService` so `UsersService` stays independent of the erase machinery — and so
 * a test can hand it a literal `{ hiddenIds: async () => [] }`. Satisfied by `UserAdminService`.
 */
export interface HiddenUserSource {
  hiddenIds(projectId: string): Promise<string[]>;
}

/** The read path's stand-in when nothing has been hidden — also the default for manual wiring. */
export const NO_HIDDEN_USERS: HiddenUserSource = { hiddenIds: async () => [] };
