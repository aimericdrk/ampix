/**
 * Property-reference resolution for the analytics query engine (contracts §14). A user-supplied
 * `property` name resolves in exactly one of two ways, and BOTH are injection-safe:
 *
 *  - a known `analytics.events` column (the fixed whitelist below) -> that literal column
 *    identifier. The identifier text that lands in the SQL string is always one of OUR OWN
 *    constants (the map's value), never the caller's raw string — even though, on a whitelist
 *    hit, the two happen to be equal. An attacker cannot smuggle SQL through a "column name"
 *    because membership is decided by an exact-match lookup against a fixed, hardcoded set of
 *    ~20 identifiers; anything that isn't an exact match simply falls through to the branch below.
 *  - anything else -> a "custom" JSON property, extracted at query time via
 *    `JSONExtractString(toJSONString(properties), {key:String})` with the raw key bound as a
 *    query parameter — it NEVER appears in the SQL text itself.
 *
 * Implementation note (verified against a live `clickhouse-server:24.8` container):
 * `analytics.events.properties` is ClickHouse's native `JSON` column type, not a `String` column
 * holding JSON text. `JSONExtractString`/`JSONExtractUInt`/`JSONExtractKeys` all require a
 * `String` argument — calling them directly on a `JSON`-typed column fails with
 * `DB::Exception: ... illegal type: JSON (ILLEGAL_TYPE_OF_ARGUMENT)`. `toJSONString(properties)`
 * re-serializes the native JSON value back into a string first, which the JSONExtract* functions
 * can then parse. This is the precise, version-correct realization of the §14 rule for this
 * schema, confirmed to both extract known keys correctly AND to treat injection-attempt keys as
 * inert data (no match, no error, table untouched).
 */

/**
 * Canonical SQL expression for an event's source ('client' | 'server'). The `source` column is
 * DEFAULT '' so rows written before the column existed read as '': for those, the RevenueCat
 * webhook writer's historical `sdk_version = 'revenuecat-webhook'` stamp is the only server
 * marker — everything else was SDK-emitted. Every literal here is OUR OWN fixed constant
 * (same injection-safety argument as the `$identify` literals in the identity MV DDL); no
 * caller input ever reaches this text.
 */
export const EVENT_SOURCE_EXPR =
  "if(source != '', source, if(sdk_version = 'revenuecat-webhook', 'server', 'client'))";

// Keys are the only valid *input*; each value is our OWN literal column-name constant or fixed
// expression (never the caller's string), so a "whitelist hit" can only ever emit one of these
// fixed SQL fragments.
const EVENT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  event: 'event',
  source: EVENT_SOURCE_EXPR,
  distinct_id: 'distinct_id',
  anon_id: 'anon_id',
  session_id: 'session_id',
  os: 'os',
  os_version: 'os_version',
  app_version: 'app_version',
  app_build: 'app_build',
  device_model: 'device_model',
  device_manufacturer: 'device_manufacturer',
  locale: 'locale',
  timezone: 'timezone',
  network: 'network',
  sdk_version: 'sdk_version',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  utm_term: 'utm_term',
  first_utm_source: 'first_utm_source',
  first_utm_campaign: 'first_utm_campaign',
});

/** The §14 whitelist, exposed for `/meta/properties` (`type: "column"` entries). */
export const EVENT_COLUMN_WHITELIST: ReadonlySet<string> = new Set(Object.keys(EVENT_COLUMNS));

export interface ResolvedProperty {
  /** The SQL expression to embed: a bare column identifier, or a JSONExtractString(...) call. */
  expr: string;
  /** True when `property` resolved to a whitelisted column (no bound key param was needed). */
  isColumn: boolean;
}

/**
 * Resolves a user-supplied property reference to a SQL expression, mutating `params` in place to
 * bind the custom-property key when needed. `paramName` must be unique within the query this
 * expression is embedded in (callers pass e.g. `filterKey0`, `breakdownKey`).
 */
export function resolveProperty(
  property: string,
  paramName: string,
  params: Record<string, unknown>,
): ResolvedProperty {
  // hasOwnProperty (not a bare `EVENT_COLUMNS[property]` lookup) so that
  // Object.prototype-inherited names — `constructor`, `__proto__`, `toString`,
  // `hasOwnProperty`, `valueOf`, … — do NOT resolve as whitelisted columns.
  // A bare lookup would return the inherited builtin (a Function/Object) and
  // splice its stringified form into the SQL text, bypassing the bound-param
  // invariant. Inherited names correctly fall through to the custom-key branch.
  if (Object.prototype.hasOwnProperty.call(EVENT_COLUMNS, property)) {
    return { expr: EVENT_COLUMNS[property]!, isColumn: true };
  }
  params[paramName] = property;
  return {
    expr: `JSONExtractString(toJSONString(properties), {${paramName}:String})`,
    isColumn: false,
  };
}
