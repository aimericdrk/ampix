import { ALIASES_CTE } from '../support/identity';
import {
  RC_CANCELLATION,
  RC_EXPIRATION,
  RC_INITIAL,
  RC_RENEWAL,
} from '../../revenuecat/metrics/rc-metrics.constants';
import type { JourneyOutcome } from './journey.types';
import { CLIENT_EVENTS_ONLY } from '../support/property-resolver';

/** The `rc-metrics.constants` property expressions read an unqualified `properties`; every scan
 *  here aliases the events table as `e` and joins `aliases` beside it, so the column needs the
 *  qualifier or ClickHouse cannot resolve it. Spelled out rather than rewritten from the shared
 *  constants — a regex over someone else's SQL string is not a dependency worth having. */
const prop = (name: string) => `JSONExtractString(toJSONString(e.properties), '${name}')`;

/**
 * Every SQL string in this module is built from OUR OWN compile-time constants — reserved event
 * names, fixed JSON property expressions, and the outcome switch below. Nothing here interpolates
 * a request value: `projectId`, the date bounds, the window length and the step count are all
 * bound as ClickHouse query params by the caller. Same discipline as `identity.ts`.
 */

/** RevenueCat reports a refund as a cancellation (or, once the entitlement lapses, an expiration)
 *  whose reason is `CUSTOMER_SUPPORT` — there is no distinct REFUND webhook type. A voluntary
 *  unsubscribe carries `UNSUBSCRIBE` and is deliberately NOT counted here: a user who turns off
 *  auto-renew has not asked for their money back, and folding the two together would blur the very
 *  distinction this page exists to draw. */
const REFUND_REASON = 'CUSTOMER_SUPPORT';
const REFUND_PREDICATE =
  `((e.event = '${RC_CANCELLATION}' AND ${prop('$rc_cancel_reason')} = '${REFUND_REASON}')` +
  ` OR (e.event = '${RC_EXPIRATION}' AND ${prop('$rc_expiration_reason')} = '${REFUND_REASON}'))`;

const PURCHASE_PREDICATE = `e.event = '${RC_INITIAL}'`;

/** Subscription lifecycle events are the outcome family, not behaviour leading up to it, so the
 *  behavioural window excludes them (matching `RcAttributionService`'s existing scans). */
export const EXCLUDED_EVENT_PREFIX = '$rc';
const BEHAVIOUR_FILTER = `e.event NOT LIKE '${EXCLUDED_EVENT_PREFIX}%'`;

const SCREEN_NAME_EXPR = prop('$screen_name');

export interface OutcomeSpec {
  /** Predicate over `events AS e` selecting the outcome event. */
  predicate: string;
  /** Reserved event names the predicate can match — surfaced in the response definition. */
  events: string[];
  /** Predicate selecting the event the cohort's elapsed time is measured FROM; `null` means
   *  "the user's first event of any kind". */
  originPredicate: string | null;
  outcomeCriteria: string;
  controlCriteria: string;
  daysToOutcomeDefinition: string;
  /** Control users must ALSO satisfy this (refunds compare against subscribers who kept the
   *  subscription — comparing a refunder to someone who never paid answers a different question). */
  controlRequires: string | null;
}

export function outcomeSpec(outcome: JourneyOutcome): OutcomeSpec {
  if (outcome === 'renew') {
    return {
      predicate: `e.event = '${RC_RENEWAL}'`,
      events: [RC_RENEWAL],
      originPredicate: PURCHASE_PREDICATE,
      outcomeCriteria: `Users whose first ${RC_RENEWAL} falls in the selected range.`,
      controlCriteria:
        `Users who bought (${RC_INITIAL}) at any time and have never renewed. Their window is ` +
        `anchored on their last event inside the selected range, since they have no outcome ` +
        `event to anchor on — so both groups are measured over their most recent activity.`,
      daysToOutcomeDefinition: `Days from the user's first ${RC_INITIAL} to their first ${RC_RENEWAL}.`,
      // Renewal is only available to someone who already paid, so the control is other
      // subscribers — comparing a renewer against someone who never bought would just re-measure
      // the decision to subscribe.
      controlRequires: PURCHASE_PREDICATE,
    };
  }
  if (outcome === 'refund') {
    return {
      predicate: REFUND_PREDICATE,
      events: [RC_CANCELLATION, RC_EXPIRATION],
      originPredicate: PURCHASE_PREDICATE,
      outcomeCriteria:
        `Users whose first refund falls in the selected range. A refund is a ${RC_CANCELLATION} ` +
        `with $rc_cancel_reason = ${REFUND_REASON}, or a ${RC_EXPIRATION} with ` +
        `$rc_expiration_reason = ${REFUND_REASON} — RevenueCat has no distinct refund event type. ` +
        `A voluntary unsubscribe (reason UNSUBSCRIBE) is NOT a refund and is excluded.`,
      controlCriteria:
        `Users who bought (${RC_INITIAL}) at any time and have never refunded. Their window is ` +
        `anchored on their last event inside the selected range, since they have no outcome ` +
        `event to anchor on — so both groups are measured over their most recent activity.`,
      daysToOutcomeDefinition: `Days from the user's first ${RC_INITIAL} to their first refund.`,
      controlRequires: PURCHASE_PREDICATE,
    };
  }
  return {
    predicate: PURCHASE_PREDICATE,
    events: [RC_INITIAL],
    originPredicate: null,
    outcomeCriteria: `Users whose first ${RC_INITIAL} falls in the selected range.`,
    controlCriteria:
      `Users with activity in the selected range who have never bought (${RC_INITIAL}) at any ` +
      `time. Their window is anchored on their last event inside the range, since they have no ` +
      `outcome event to anchor on — so both groups are measured over their most recent activity.`,
    daysToOutcomeDefinition: `Days from the user's first event of any kind to their first ${RC_INITIAL}.`,
    controlRequires: null,
  };
}

/** `uid` for a row of `events AS e` once the alias join is attached. */
const UID = `coalesce(aliases.canonical_id, e.distinct_id)`;
const ALIAS_JOIN = `LEFT JOIN aliases ON e.distinct_id = aliases.anon_id`;

/**
 * The shared CTE prelude: the alias map, the cohort's anchors (first outcome in range), the
 * control's anchors (last event in range, for users who never had the outcome), and the behavioural
 * window hanging off both. `win` carries a `grp` label so one scan serves both groups.
 *
 * The window scan is bounded by `[from - window, toExclusive)` as well as by each user's anchor:
 * the anchor bound alone is correct but opaque to ClickHouse's partition pruning, and without the
 * literal timestamp range the query reads every partition the project has ever written.
 */
export function journeyCtes(spec: OutcomeSpec): string {
  const everOutcome = `
    ever_outcome AS (
      SELECT DISTINCT ${UID} AS uid
      FROM events AS e ${ALIAS_JOIN}
      WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY} AND ${spec.predicate}
    )`;

  const controlRequired = spec.controlRequires
    ? `
    control_required AS (
      SELECT DISTINCT ${UID} AS uid
      FROM events AS e ${ALIAS_JOIN}
      WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY} AND ${spec.controlRequires}
    ),`
    : '';

  const controlRequiredJoin = spec.controlRequires
    ? `AND uid IN (SELECT uid FROM control_required)`
    : '';

  return `
    ${ALIASES_CTE},
    ${everOutcome},
    ${controlRequired}
    cohort_users AS (
      SELECT ${UID} AS uid, min(e.timestamp) AS anchor
      FROM events AS e ${ALIAS_JOIN}
      WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY} AND ${spec.predicate}
        AND e.timestamp >= {from:DateTime64} AND e.timestamp < {toExclusive:DateTime64}
      GROUP BY uid
    ),
    control_users AS (
      SELECT ${UID} AS uid, max(e.timestamp) AS anchor
      FROM events AS e ${ALIAS_JOIN}
      WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY}
        AND e.timestamp >= {from:DateTime64} AND e.timestamp < {toExclusive:DateTime64}
      GROUP BY uid
      HAVING uid NOT IN (SELECT uid FROM ever_outcome) ${controlRequiredJoin}
    ),
    anchors AS (
      SELECT 'cohort' AS grp, uid, anchor FROM cohort_users
      UNION ALL
      SELECT 'control' AS grp, uid, anchor FROM control_users
    ),
    win AS (
      SELECT a.grp AS grp, a.uid AS uid, e.event AS event, e.session_id AS session_id,
             e.timestamp AS ts, a.anchor AS anchor, ${SCREEN_NAME_EXPR} AS screen_name
      FROM events AS e
      ${ALIAS_JOIN}
      INNER JOIN anchors AS a ON ${UID} = a.uid
      WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY}
        AND ${BEHAVIOUR_FILTER}
        AND e.timestamp >= {from:DateTime64} - toIntervalDay({windowDays:UInt16})
        AND e.timestamp < {toExclusive:DateTime64}
        -- The cohort's anchor IS the outcome event, and an outcome is not behaviour leading up to
        -- itself, so it is excluded. The control's anchor is an ordinary event of theirs; excluding
        -- it too would drop one real event from EVERY control user and quietly bias every
        -- cohort-vs-control comparison in the cohort's favour.
        AND if(a.grp = 'cohort', e.timestamp < a.anchor, e.timestamp <= a.anchor)
        AND e.timestamp >= a.anchor - toIntervalDay({windowDays:UInt16})
    )`;
}

/**
 * Headline per-user distributions for both groups. Anchored users with NO events in the window are
 * kept via the LEFT JOIN and count as zero — dropping them would silently summarise only the
 * active half of each group and inflate every median.
 */
export function summarySql(spec: OutcomeSpec): string {
  return `WITH ${journeyCtes(spec)},
    per_user AS (
      SELECT a.grp AS grp, a.uid AS uid,
             countIf(w.ts IS NOT NULL) AS steps,
             uniqExactIf(w.session_id, w.ts IS NOT NULL) AS sessions,
             uniqExactIf(w.event, w.ts IS NOT NULL) AS distinct_events
      FROM anchors AS a
      LEFT JOIN win AS w ON a.grp = w.grp AND a.uid = w.uid
      GROUP BY grp, uid
    )
    SELECT grp,
           count() AS users,
           quantileExact(0.25)(steps) AS steps_p25,
           quantileExact(0.5)(steps) AS steps_p50,
           quantileExact(0.75)(steps) AS steps_p75,
           quantileExact(0.25)(sessions) AS sessions_p25,
           quantileExact(0.5)(sessions) AS sessions_p50,
           quantileExact(0.75)(sessions) AS sessions_p75,
           quantileExact(0.25)(distinct_events) AS names_p25,
           quantileExact(0.5)(distinct_events) AS names_p50,
           quantileExact(0.75)(distinct_events) AS names_p75
    FROM per_user GROUP BY grp`;
}

/** Elapsed days from the outcome's origin event to the outcome itself. Cohort only — the control
 *  has no outcome, so there is nothing to measure to. */
export function daysToOutcomeSql(spec: OutcomeSpec): string {
  const originFilter = spec.originPredicate ? `AND ${spec.originPredicate}` : '';
  return `WITH ${journeyCtes(spec)},
    origins AS (
      SELECT ${UID} AS uid, min(e.timestamp) AS origin
      FROM events AS e ${ALIAS_JOIN}
      WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY} ${originFilter}
      GROUP BY uid
    )
    SELECT quantileExact(0.25)(days) AS p25,
           quantileExact(0.5)(days) AS p50,
           quantileExact(0.75)(days) AS p75,
           count() AS users
    FROM (
      SELECT dateDiff('second', o.origin, c.anchor) / 86400 AS days
      FROM cohort_users AS c INNER JOIN origins AS o ON c.uid = o.uid
      WHERE o.origin <= c.anchor
    )`;
}

/**
 * Every (position, event) pair in the cohort's window, ranked. `row_number()` numbers each user's
 * events backwards from their outcome, so position 1 is always the step immediately before it; the
 * caller keeps the top row per position as the modal step and reads `users` as how typical it is.
 */
export function pathSql(spec: OutcomeSpec): string {
  return `WITH ${journeyCtes(spec)},
    steps AS (
      SELECT uid, event, screen_name, ts, anchor,
             row_number() OVER (PARTITION BY uid ORDER BY ts DESC, event ASC) AS rpos
      FROM win WHERE grp = 'cohort'
    )
    SELECT rpos AS steps_before_outcome, event, screen_name,
           uniqExact(uid) AS users,
           quantileExact(0.5)(dateDiff('second', ts, anchor)) AS median_seconds_to_outcome
    FROM steps
    WHERE rpos <= {pathSteps:UInt16}
    GROUP BY rpos, event, screen_name
    ORDER BY rpos ASC, users DESC, event ASC`;
}

/** Occurrences and reach per event, per group. Averaged over EVERY user in the group (including
 *  those with none) by the caller, so the two columns are directly comparable. */
export function frequencySql(spec: OutcomeSpec): string {
  return `WITH ${journeyCtes(spec)}
    SELECT grp, event AS name, count() AS occurrences, uniqExact(uid) AS users
    FROM win GROUP BY grp, name`;
}

/**
 * Which subscription the outcome actually was, straight off the RevenueCat webhook's `$product_id`
 * and `$rc_period_type`. Pinned to `c.anchor` — the timestamp of the event that PUT the user in the
 * cohort — so a user with several purchases is counted once, against the one being analysed.
 */
export function productsSql(spec: OutcomeSpec): string {
  return `WITH ${journeyCtes(spec)}
    SELECT ${prop('$product_id')} AS product_id,
           ${prop('$rc_period_type')} AS period_type,
           uniqExact(${UID}) AS users
    FROM events AS e
    ${ALIAS_JOIN}
    INNER JOIN cohort_users AS c ON ${UID} = c.uid
    WHERE e.project_id = {projectId:UUID} AND ${CLIENT_EVENTS_ONLY} AND ${spec.predicate}
      AND e.timestamp = c.anchor
    GROUP BY product_id, period_type
    ORDER BY users DESC, product_id ASC
    LIMIT 25`;
}

/** The same shape as {@link frequencySql}, over screen names rather than event names. */
export function screensSql(spec: OutcomeSpec): string {
  return `WITH ${journeyCtes(spec)}
    SELECT grp, screen_name AS name, count() AS occurrences, uniqExact(uid) AS users
    FROM win
    WHERE event = '$screen_view' AND screen_name != ''
    GROUP BY grp, name`;
}
