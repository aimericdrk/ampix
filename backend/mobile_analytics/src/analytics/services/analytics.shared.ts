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
