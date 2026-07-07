import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import {
  ClickHouseService,
  fromChDateTime64,
  toChDateTime64,
} from '../clickhouse/clickhouse.service';
import { CohortsService } from '../cohorts/cohorts.service';
import { ProjectsService } from '../projects/projects.service';
import type {
  EventsMetaResponse,
  InsightsResponse,
  InsightsSeries,
  LiveEventsResponse,
  PropertiesMetaResponse,
  PropertyMeta,
  PropertyValuesResponse,
  RevenueSummaryResponse,
  SessionsSummaryResponse,
  UserProfileResponse,
  UsersResponse,
} from './analytics.types';
import { Bucket, buildBucketGrid, parseDateOnlyUTC } from './bucket-grid';
import { ALIASES_CTE, canonicalization, RESOLVE_CANONICAL_ID_SQL } from './identity';
import { compileInsightsQuery } from './insights.compiler';
import { insightsQuerySchema } from './insights-query.schema';
import { EVENT_COLUMN_WHITELIST, resolveProperty } from './property-resolver';
import {
  clampLimit,
  clampPropertyValuesLimit,
  parseIsoInstantParam,
  resolveDateOnlyRange,
} from './read-query.util';
import { ProblemException } from '../common/problem-details';

/** contracts §14: metadata endpoints scan "distinct event names / property keys, last 30 days". */
const META_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

interface TopBreakdownRow {
  breakdown_value: string;
  total: string | number;
}

interface SeriesRow {
  bucket_ts: string | number;
  breakdown_value?: string;
  value: string | number;
}

interface MetaEventRow {
  event: string;
}

interface MetaPropertyKeyRow {
  key: string;
}

interface PropertyValueRow {
  value: string;
}

interface LiveEventRow {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  os: string;
  app_version: string;
}

interface UserRow {
  distinct_id: string;
  last_seen: string;
  event_count: string | number;
  name: string;
  email: string;
}

interface ProfilePropertiesRow {
  properties: Record<string, unknown>;
}

interface UserAggRow {
  first_seen: string;
  last_seen: string;
  event_count: string | number;
}

interface RecentEventRow {
  insert_id: string;
  event: string;
  timestamp: string;
  screen_name: string;
}

interface SessionsTotalsRow {
  sessions: string | number;
  avg_duration_ms: string | number;
}

interface SessionsDayRow {
  day: string;
  sessions: string | number;
  avg_duration_ms: string | number;
}

interface RevenueTotalsRow {
  total_revenue: string | number;
  purchases: string | number;
  paying_users: string | number;
}

interface RevenueDayRow {
  day: string;
  revenue: string | number;
  purchases: string | number;
}

interface RevenueProductRow {
  product_id: string;
  revenue: string | number;
  purchases: string | number;
}

/** contracts §14: `/sessions/summary` reads `$session_end` events' `$duration_ms` property. Both
 *  are OUR OWN fixed reserved-name constants (contracts §4), never user input, so — matching how
 *  `infra/clickhouse/init.sql`'s `daily_sessions_mv` does it — they're embedded as SQL literals
 *  rather than bound params; only caller-supplied values ever need binding. */
const SESSION_END_EVENT = '$session_end';
const DURATION_MS_EXPR = "JSONExtractFloat(toJSONString(properties), '$duration_ms')";

/** contracts §19: `/metrics/revenue` reads `$in_app_purchase` events' `$price`/`$product_id`
 *  properties. Same doctrine as `SESSION_END_EVENT`/`DURATION_MS_EXPR` above — these are OUR OWN
 *  fixed reserved-name constants (contracts §4), never user input, so embedded as SQL literals;
 *  only caller-supplied values (projectId, date range) are ever bound as params. */
const IN_APP_PURCHASE_EVENT = '$in_app_purchase';
const PRICE_EXPR = "JSONExtractFloat(toJSONString(properties), '$price')";
const PRODUCT_ID_EXPR = "JSONExtractString(toJSONString(properties), '$product_id')";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `GET /users` search whitelist (contracts §14): profile string properties a `search` term may
 * match, in addition to the canonical id and its aliased anon_ids. These are OUR OWN fixed
 * constants embedded as SQL literals inside `JSONExtractString(toJSONString(up.properties), '<key>')`
 * — never caller input — matching the injection-safety doctrine in `property-resolver.ts`. The
 * search VALUE itself is always the bound `{search:String}` param.
 */
const USER_SEARCH_PROFILE_KEYS = ['name', 'email', 'username', '$name', '$email'] as const;

function sinceParam(): string {
  return toChDateTime64(Date.now() - META_LOOKBACK_MS);
}

/** Reindexes ClickHouse's (sparse) grouped rows onto the full zero-filled bucket grid. */
function zeroFill(
  buckets: Bucket[],
  rows: Pick<SeriesRow, 'bucket_ts' | 'value'>[],
): { t: string; value: number }[] {
  const byTs = new Map<number, number>();
  for (const row of rows) {
    byTs.set(Number(row.bucket_ts), Number(row.value));
  }
  return buckets.map((bucket) => ({ t: bucket.t, value: byTs.get(bucket.ts) ?? 0 }));
}

/**
 * Core analytics query engine (contracts §14): read-only over `analytics.events`, always scoped
 * by `project_id` and always gated by project membership (any role — "viewer+" is satisfied by
 * the mere existence of a Membership row, same as `ProjectsService.getEventsSummary`). Reuses
 * `ProjectsService.assertMembership` rather than duplicating the 404-then-403 tenancy check.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    private readonly cohorts: CohortsService,
  ) {}

  /**
   * Compiles + executes an insights query. Breakdown queries are 2-phase: first discover the top
   * `MAX_BREAKDOWN_VALUES` (insights.compiler.ts) values across all selected events, then run each
   * event's own bucketed series query restricted to those values. Raw events are queried directly
   * (not the rollup MVs) so results are exact — contracts §14's correctness note. An optional §16
   * `cohort_id` narrows every series to `distinct_id IN (<cohort subquery>)`, fully parameterized.
   */
  async runInsightsQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<InsightsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(insightsQuerySchema, body);
    const cohort = query.cohort_id
      ? await this.cohorts.resolveCohortPredicate(projectId, query.cohort_id)
      : undefined;
    const compiled = compileInsightsQuery(query, projectId, cohort);

    let breakdownValues: string[] | undefined;
    if (compiled.topBreakdownValuesQuery) {
      const rows = await this.clickhouse.query<TopBreakdownRow>(
        compiled.topBreakdownValuesQuery.sql,
        compiled.topBreakdownValuesQuery.params,
      );
      breakdownValues = rows.map((row) => row.breakdown_value);
    }

    const series: InsightsSeries[] = [];
    for (const seriesQuery of compiled.seriesQueries) {
      const params = breakdownValues
        ? { ...seriesQuery.params, breakdownValues }
        : seriesQuery.params;
      // `settings` is set only for `unique_users` series (contracts §17: the canonicalizing LEFT
      // JOIN needs `join_use_nulls=1`); `total` series pass `undefined` and keep default behavior.
      const rows = await this.clickhouse.query<SeriesRow>(
        seriesQuery.sql,
        params,
        seriesQuery.settings,
      );

      if (breakdownValues) {
        for (const breakdownValue of breakdownValues) {
          const rowsForValue = rows.filter((row) => row.breakdown_value === breakdownValue);
          series.push({
            name: seriesQuery.eventName,
            breakdown_value: breakdownValue,
            data: zeroFill(compiled.buckets, rowsForValue),
          });
        }
      } else {
        series.push({
          name: seriesQuery.eventName,
          breakdown_value: null,
          data: zeroFill(compiled.buckets, rows),
        });
      }
    }

    return { series };
  }

  /** GET /meta/events — distinct event names, last 30 days. */
  async listEventNames(userId: string, projectId: string): Promise<EventsMetaResponse> {
    await this.projects.assertMembership(userId, projectId);
    const rows = await this.clickhouse.query<MetaEventRow>(
      `SELECT DISTINCT event
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
       ORDER BY event`,
      { projectId, since: sinceParam() },
    );
    return { events: rows.map((row) => row.event) };
  }

  /**
   * GET /meta/properties — known columns (`type: "column"`) plus distinct top-level `properties`
   * JSON keys seen in the last 30 days (`type: "string"`), optionally narrowed to one event name.
   */
  async listProperties(
    userId: string,
    projectId: string,
    event?: string,
  ): Promise<PropertiesMetaResponse> {
    await this.projects.assertMembership(userId, projectId);

    const columnProps: PropertyMeta[] = [...EVENT_COLUMN_WHITELIST]
      .sort()
      .map((name) => ({ name, type: 'column' as const }));

    const params: Record<string, unknown> = { projectId, since: sinceParam() };
    let eventClause = '';
    if (event !== undefined) {
      params.eventName = event;
      eventClause = 'AND event = {eventName:String}\n         ';
    }

    const rows = await this.clickhouse.query<MetaPropertyKeyRow>(
      `SELECT DISTINCT arrayJoin(JSONExtractKeys(toJSONString(properties))) AS key
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
         ${eventClause}LIMIT 200`,
      params,
    );
    const customProps: PropertyMeta[] = rows.map((row) => ({
      name: row.key,
      type: 'string' as const,
    }));

    return { properties: [...columnProps, ...customProps] };
  }

  /**
   * GET /meta/property-values — the DISTINCT values of ONE property over the last 30 days,
   * frequency-ranked (most frequent first), capped, with empty values excluded — a filter-value
   * autosuggest dropdown. `property` is resolved via {@link resolveProperty}: a whitelisted column
   * emits its own literal identifier, anything else is a custom JSON key bound as `{propKey:String}`
   * — the caller's string is NEVER interpolated into SQL. An absent/blank `property` is a 400 (no
   * sensible default value list to fall back to), matching the module's "malformed input -> 400"
   * rule. An optional `event` narrows the scan, bound as `{eventName:String}` exactly as
   * `listProperties` does. `limit` is clamped (never rejected) — default 50, max 200.
   */
  async listPropertyValues(
    userId: string,
    projectId: string,
    property: string | undefined,
    event?: string,
    limitRaw?: string,
  ): Promise<PropertyValuesResponse> {
    await this.projects.assertMembership(userId, projectId);

    if (property === undefined || property === '') {
      throw new ProblemException({ status: 400, title: 'Bad Request', detail: 'property: required' });
    }

    const limit = clampPropertyValuesLimit(limitRaw);
    const params: Record<string, unknown> = { projectId, since: sinceParam(), limit };
    const resolved = resolveProperty(property, 'propKey', params);

    let eventClause = '';
    if (event !== undefined) {
      params.eventName = event;
      eventClause = 'AND event = {eventName:String}\n         ';
    }

    const rows = await this.clickhouse.query<PropertyValueRow>(
      `SELECT ${resolved.expr} AS value, count() AS cnt
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
         AND ${resolved.expr} != ''
         ${eventClause}GROUP BY value
       ORDER BY cnt DESC, value ASC
       LIMIT {limit:UInt64}`,
      params,
    );
    return { values: rows.map((row) => row.value) };
  }

  /**
   * GET /events/live — newest-first raw event feed. `limit` is clamped (never rejected);
   * `before`, when present, is a hard 400 on a malformed ISO instant since — unlike `limit` —
   * there's no sane default to silently fall back to. `next_before` is simply the last returned
   * row's timestamp (or `null` when the page is empty), ready to feed back in as the next `before`.
   */
  async getLiveEvents(
    userId: string,
    projectId: string,
    limitRaw?: string,
    beforeRaw?: string,
  ): Promise<LiveEventsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const limit = clampLimit(limitRaw);
    const before = parseIsoInstantParam(beforeRaw, 'before');

    const params: Record<string, unknown> = { projectId, limit };
    let beforeClause = '';
    if (before !== undefined) {
      params.before = before;
      beforeClause = 'AND timestamp < {before:DateTime64}\n         ';
    }

    const rows = await this.clickhouse.query<LiveEventRow>(
      `SELECT insert_id, event, distinct_id, timestamp, os, app_version
       FROM events
       WHERE project_id = {projectId:UUID}
         ${beforeClause}ORDER BY timestamp DESC
       LIMIT {limit:UInt64}`,
      params,
    );

    const events = rows.map((row) => ({
      insert_id: row.insert_id,
      event: row.event,
      distinct_id: row.distinct_id,
      timestamp: fromChDateTime64(row.timestamp),
      os: row.os,
      app_version: row.app_version,
    }));

    return { events, next_before: events.length > 0 ? events[events.length - 1].timestamp : null };
  }

  /**
   * GET /users — the users explorer list, derived from `events` (there is no standalone "users"
   * table). Identity-resolved (contracts §17): rows are grouped/counted by the CANONICAL id
   * (`uid` = the identified user for an anon that logged in, else the raw id) via the shared
   * `canonicalization()` helper, so an anonymous→identified user appears ONCE. The shown
   * `distinct_id` is that canonical `uid`; `cursor` keyset-paginates over the canonical id, bound
   * as a plain param (never concatenated) and evaluated over the canonical expression, not the raw
   * column. Fetches one extra row to know whether a `next_cursor` exists without a second COUNT
   * query.
   *
   * `search`, when present, is a case-insensitive SUBSTRING match (`positionCaseInsensitiveUTF8`)
   * against any of: the canonical id, the raw `e.distinct_id` (so an aliased anon_id also matches),
   * or a whitelisted profile string property (`USER_SEARCH_PROFILE_KEYS` — OUR OWN fixed constants,
   * embedded as SQL literals; never caller input, matching `property-resolver.ts`'s doctrine). The
   * search TERM itself is bound once as `{search:String}` and reused across every branch of the OR.
   * Profile properties come from a LEFT JOIN of `user_profiles FINAL` keyed on the canonical `uid`
   * (mirrors how `getUserProfile` reads `user_profiles`); `name`/`email` are read straight off that
   * same join (`any(...)` — the subquery is already deduped 1:1 per canonical id via `FINAL`, so the
   * aggregate simply satisfies ClickHouse's GROUP BY rule without changing the value) and mapped to
   * `null` when absent/empty.
   */
  async listUsers(
    userId: string,
    projectId: string,
    searchRaw?: string,
    limitRaw?: string,
    cursorRaw?: string,
  ): Promise<UsersResponse> {
    await this.projects.assertMembership(userId, projectId);
    const limit = clampLimit(limitRaw);
    const canon = canonicalization();

    const params: Record<string, unknown> = { projectId, limit: limit + 1 };
    const whereClauses = ['e.project_id = {projectId:UUID}'];
    if (searchRaw) {
      params.search = searchRaw;
      const searchExprs = [
        canon.uid,
        'e.distinct_id',
        ...USER_SEARCH_PROFILE_KEYS.map(
          (key) => `JSONExtractString(toJSONString(up.properties), '${key}')`,
        ),
      ];
      whereClauses.push(
        `(${searchExprs
          .map((expr) => `positionCaseInsensitiveUTF8(${expr}, {search:String}) > 0`)
          .join('\n           OR ')})`,
      );
    }
    if (cursorRaw) {
      params.cursor = cursorRaw;
      whereClauses.push(`${canon.uid} > {cursor:String}`);
    }

    const rows = await this.clickhouse.query<UserRow>(
      `WITH ${canon.cte}
       SELECT ${canon.uid} AS distinct_id,
              max(e.timestamp) AS last_seen,
              count(DISTINCT e.insert_id) AS event_count,
              any(JSONExtractString(toJSONString(up.properties), 'name')) AS name,
              any(JSONExtractString(toJSONString(up.properties), 'email')) AS email
       FROM events AS e
       ${canon.join}
       LEFT JOIN (
         SELECT distinct_id, properties FROM user_profiles FINAL WHERE project_id = {projectId:UUID}
       ) AS up ON up.distinct_id = ${canon.uid}
       WHERE ${whereClauses.join('\n         AND ')}
       GROUP BY ${canon.uid}
       ORDER BY ${canon.uid}
       LIMIT {limit:UInt64}`,
      params,
      canon.settings,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const users = page.map((row) => ({
      distinct_id: row.distinct_id,
      last_seen: fromChDateTime64(row.last_seen),
      event_count: Number(row.event_count),
      name: row.name || null,
      email: row.email || null,
    }));

    return { users, next_cursor: hasMore ? page[page.length - 1].distinct_id : null };
  }

  /**
   * GET /users/:distinctId — one user's MERGED profile + activity (contracts §17). `distinctId` is
   * free-form client text (not a UUID like `projectId`), so it is always bound as a param, never
   * interpolated. Two-step identity resolution: (1) resolve the requested id to its canonical id —
   * if the caller passed an `anon_id` that aliases to a user, we return that user's profile; a
   * plain user id (or an unknown id) resolves to itself. (2) aggregate events by canonical `uid`,
   * so the profile for user `X` includes events from `X` AND from every anon_id whose canonical is
   * `X`. The event lookups are canonicalized via the shared `canonicalization()` helper; the
   * profile itself comes from `user_profiles FINAL` keyed by the canonical id. The 3 post-resolution
   * lookups are independent and run concurrently; `Promise.all` starts them in a fixed order,
   * keeping mocked `clickhouse.query` call sequences deterministic in tests. An unknown id isn't a
   * 404 — it just yields an empty profile / zero counts / no recent events.
   */
  async getUserProfile(
    userId: string,
    projectId: string,
    distinctId: string,
  ): Promise<UserProfileResponse> {
    await this.projects.assertMembership(userId, projectId);

    // Step 1: resolve the requested id to its canonical id (empty result -> it is already canonical
    // or simply unknown, so fall back to the requested id).
    const resolvedRows = await this.clickhouse.query<{ canonical_id: string }>(
      RESOLVE_CANONICAL_ID_SQL,
      { projectId, distinctId },
    );
    const canonicalId = resolvedRows[0]?.canonical_id || distinctId;

    // Step 2: profile (canonical id) + merged events (canonical `uid`).
    const canon = canonicalization();
    const idParams = { projectId, canonicalId };
    const [profileRows, aggRows, recentRows, aliasRows] = await Promise.all([
      this.clickhouse.query<ProfilePropertiesRow>(
        `SELECT properties
         FROM user_profiles FINAL
         WHERE project_id = {projectId:UUID}
           AND distinct_id = {canonicalId:String}
         LIMIT 1`,
        idParams,
      ),
      this.clickhouse.query<UserAggRow>(
        `WITH ${canon.cte}
         SELECT
           min(e.timestamp) AS first_seen,
           max(e.timestamp) AS last_seen,
           count(DISTINCT e.insert_id) AS event_count
         FROM events AS e
         ${canon.join}
         WHERE e.project_id = {projectId:UUID}
           AND ${canon.uid} = {canonicalId:String}`,
        idParams,
        canon.settings,
      ),
      this.clickhouse.query<RecentEventRow>(
        `WITH ${canon.cte}
         SELECT e.insert_id AS insert_id, e.event AS event, e.timestamp AS timestamp,
                JSONExtractString(toJSONString(e.properties), '$screen_name') AS screen_name
         FROM events AS e
         ${canon.join}
         WHERE e.project_id = {projectId:UUID}
           AND ${canon.uid} = {canonicalId:String}
         ORDER BY e.timestamp DESC
         LIMIT 50`,
        idParams,
        canon.settings,
      ),
      // §17 identity set: every anon_id whose canonical is this user. A plain aliases lookup (no
      // LEFT JOIN, so `canon.settings` is not needed) keyed by the resolved canonical id. Fed to the
      // response `distinct_ids` so the per-user click-heatmap can filter the raw `distinct_id` column
      // across BOTH id-spaces (anonymous + identified) and stay identity-correct.
      this.clickhouse.query<{ anon_id: string }>(
        `WITH ${ALIASES_CTE}
         SELECT anon_id FROM aliases WHERE canonical_id = {canonicalId:String}`,
        idParams,
      ),
    ]);

    const eventCount = Number(aggRows[0]?.event_count ?? 0);
    // `min`/`max` over zero matching rows still return a (meaningless, epoch-default) row rather
    // than SQL NULL for a non-Nullable DateTime64 column — gate on the count, not the value.
    const firstSeen = eventCount > 0 ? fromChDateTime64(aggRows[0].first_seen) : null;
    const lastSeen = eventCount > 0 ? fromChDateTime64(aggRows[0].last_seen) : null;

    const distinctIds = Array.from(new Set([canonicalId, ...aliasRows.map((r) => r.anon_id)]));

    return {
      distinct_id: canonicalId,
      profile: profileRows[0]?.properties ?? {},
      first_seen: firstSeen,
      last_seen: lastSeen,
      event_count: eventCount,
      recent_events: recentRows.map((row) => ({
        insert_id: row.insert_id,
        event: row.event,
        timestamp: fromChDateTime64(row.timestamp),
        screen_name: row.screen_name || null,
      })),
      distinct_ids: distinctIds,
    };
  }

  /**
   * GET /sessions/summary — `$session_end` is the SDK's reserved app-session-close autocapture
   * event (contracts §4); its `$duration_ms` property carries the session length. Two queries:
   * the overall totals (one row) and the per-day breakdown, both zero-filled onto the same
   * `buildBucketGrid(..., 'day')` grid the query engine uses, so days with no sessions read as
   * `{ sessions: 0, avg_duration_ms: 0 }` rather than being omitted. `if(count(...) = 0, 0, avg(...))`
   * sidesteps `avg()` over zero rows, which ClickHouse evaluates to NaN — not valid JSON.
   */
  async getSessionsSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<SessionsSummaryResponse> {
    await this.projects.assertMembership(userId, projectId);
    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);

    const params = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
    };
    const whereClause = `project_id = {projectId:UUID}
         AND event = '${SESSION_END_EVENT}'
         AND timestamp >= {from:DateTime64}
         AND timestamp < {toExclusive:DateTime64}`;

    const [totalsRows, dayRows] = await Promise.all([
      this.clickhouse.query<SessionsTotalsRow>(
        `SELECT
           count(DISTINCT insert_id) AS sessions,
           if(count(DISTINCT insert_id) = 0, 0, avg(${DURATION_MS_EXPR})) AS avg_duration_ms
         FROM events
         WHERE ${whereClause}`,
        params,
      ),
      this.clickhouse.query<SessionsDayRow>(
        `SELECT
           toString(toDate(timestamp)) AS day,
           count(DISTINCT insert_id) AS sessions,
           if(count(DISTINCT insert_id) = 0, 0, avg(${DURATION_MS_EXPR})) AS avg_duration_ms
         FROM events
         WHERE ${whereClause}
         GROUP BY day
         ORDER BY day`,
        params,
      ),
    ]);

    const sessions = Number(totalsRows[0]?.sessions ?? 0);
    const avg_duration_ms = Number(totalsRows[0]?.avg_duration_ms ?? 0);

    const byDayMap = new Map(dayRows.map((row) => [row.day, row]));
    const by_day = buildBucketGrid(from, to, 'day').map((bucket) => {
      const row = byDayMap.get(bucket.t);
      return {
        t: bucket.t,
        sessions: row ? Number(row.sessions) : 0,
        avg_duration_ms: row ? Number(row.avg_duration_ms) : 0,
      };
    });

    return { sessions, avg_duration_ms, by_day };
  }

  /**
   * GET /metrics/revenue — `$in_app_purchase` is the SDK's reserved purchase-completed autocapture
   * event (contracts §4); its `$price`/`$product_id` properties carry the purchase amount and the
   * purchased SKU. Mirrors `getSessionsSummary`'s shape: an overall-totals query, a `by_day`
   * breakdown (zero-filled onto `buildBucketGrid(..., 'day')`), and a `by_product` breakdown (top 10
   * by revenue, empty product ids excluded — an event missing `$product_id` shouldn't pollute the
   * per-SKU breakdown). `paying_users` is identity-resolved via the shared `canonicalization()`
   * helper (contracts §17) so an anonymous->identified purchaser is counted once; the day/product
   * breakdowns don't need canonical ids (they're not counting users), so those two queries scan
   * `events` directly, matching the sessions-summary precedent. `arppu`/`avg_purchase_value` guard
   * their divisors to avoid NaN (not valid JSON) on zero purchases/payers.
   */
  async getRevenueSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<RevenueSummaryResponse> {
    await this.projects.assertMembership(userId, projectId);
    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);

    const params = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
    };
    const whereClause = `project_id = {projectId:UUID}
         AND event = '${IN_APP_PURCHASE_EVENT}'
         AND timestamp >= {from:DateTime64}
         AND timestamp < {toExclusive:DateTime64}`;

    const canon = canonicalization();

    const [totalsRows, dayRows, productRows] = await Promise.all([
      this.clickhouse.query<RevenueTotalsRow>(
        `WITH ${canon.cte}
         SELECT
           sum(${PRICE_EXPR}) AS total_revenue,
           count(DISTINCT e.insert_id) AS purchases,
           uniqExact(${canon.uid}) AS paying_users
         FROM events AS e
         ${canon.join}
         WHERE e.project_id = {projectId:UUID}
           AND e.event = '${IN_APP_PURCHASE_EVENT}'
           AND e.timestamp >= {from:DateTime64}
           AND e.timestamp < {toExclusive:DateTime64}`,
        params,
        canon.settings,
      ),
      this.clickhouse.query<RevenueDayRow>(
        `SELECT
           toString(toDate(timestamp)) AS day,
           sum(${PRICE_EXPR}) AS revenue,
           count(DISTINCT insert_id) AS purchases
         FROM events
         WHERE ${whereClause}
         GROUP BY day
         ORDER BY day`,
        params,
      ),
      this.clickhouse.query<RevenueProductRow>(
        `SELECT
           ${PRODUCT_ID_EXPR} AS product_id,
           sum(${PRICE_EXPR}) AS revenue,
           count(DISTINCT insert_id) AS purchases
         FROM events
         WHERE ${whereClause}
           AND ${PRODUCT_ID_EXPR} != ''
         GROUP BY product_id
         ORDER BY revenue DESC
         LIMIT 10`,
        params,
      ),
    ]);

    const total_revenue = Number(totalsRows[0]?.total_revenue ?? 0);
    const purchases = Number(totalsRows[0]?.purchases ?? 0);
    const paying_users = Number(totalsRows[0]?.paying_users ?? 0);
    const arppu = paying_users === 0 ? 0 : total_revenue / paying_users;
    const avg_purchase_value = purchases === 0 ? 0 : total_revenue / purchases;

    const byDayMap = new Map(dayRows.map((row) => [row.day, row]));
    const by_day = buildBucketGrid(from, to, 'day').map((bucket) => {
      const row = byDayMap.get(bucket.t);
      return {
        t: bucket.t,
        revenue: row ? Number(row.revenue) : 0,
        purchases: row ? Number(row.purchases) : 0,
      };
    });

    const by_product = productRows.map((row) => ({
      product_id: row.product_id,
      revenue: Number(row.revenue),
      purchases: Number(row.purchases),
    }));

    return { total_revenue, purchases, paying_users, arppu, avg_purchase_value, by_day, by_product };
  }
}
