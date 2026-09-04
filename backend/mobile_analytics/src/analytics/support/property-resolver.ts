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

/**
 * `WHERE …` predicate restricting a query to events a DEVICE sent (contracts §6.1.1).
 *
 * Some metrics are claims about a person: they were active today, they came back in week 3, this
 * is the path they walked. A backend writing about someone — a like they received, a message, a
 * RevenueCat webhook — is none of those things, and on a project whose backend emits per-recipient
 * events it drowns out the real signal completely (measured here: 15,484 "daily active users"
 * against 3 devices).
 *
 * So the people-centric surfaces filter to client events: engagement (DAU/WAU/MAU, new vs
 * returning, stickiness), retention, user paths / flows, and attribution. The event-centric ones
 * do NOT — insights, funnels, distributions, experiments, cohorts and revenue count the events an
 * analyst asked for, whoever wrote them, and `source` is a filterable dimension there when they
 * want to split the two.
 *
 * The journey report is the one people-centric page that does NOT filter, and it cannot: the
 * outcome it measures against IS a server row (the RevenueCat webhook writes every
 * `$rc_initial_purchase` / `$rc_renewal` / `$rc_cancellation` / `$rc_expiration`), so a device
 * filter left it with no cohort at all. `journey.sql.ts` carries the full argument.
 *
 * `'client'` is OUR OWN fixed constant (the token kind, §6.1.1), embedded as a literal exactly like
 * `$session_end` and `$identify` in the shared SQL — no caller input reaches this text.
 */
export const CLIENT_EVENTS_ONLY = `${EVENT_SOURCE_EXPR} = 'client'`;

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
  device_id: 'device_id',
  // `device_token` is deliberately NOT here. It is not a dimension anyone can
  // segment on — every device has its own — and whitelisting it would let
  // /meta/property-values page the project's push tokens out as a filter
  // autosuggest. It still reaches the read side as device context on a
  // profile (users.service), which is where it is actually useful.
  unique_id: 'unique_id',
  theme: 'theme',
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
