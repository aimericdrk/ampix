import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import {
  ClickHouseService,
  fromChDateTime64,
  toChDateTime64,
} from '../clickhouse/clickhouse.service';
import { ProjectsService } from '../projects/projects.service';
import type {
  EventsMetaResponse,
  InsightsResponse,
  InsightsSeries,
  LiveEventsResponse,
  PropertiesMetaResponse,
  PropertyMeta,
  SessionsSummaryResponse,
  UserProfileResponse,
  UsersResponse,
} from './analytics.types';
import { Bucket, buildBucketGrid, parseDateOnlyUTC } from './bucket-grid';
import { compileInsightsQuery } from './insights.compiler';
import { insightsQuerySchema } from './insights-query.schema';
import { EVENT_COLUMN_WHITELIST } from './property-resolver';
import { clampLimit, parseIsoInstantParam, resolveDateOnlyRange } from './read-query.util';

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

/** contracts §14: `/sessions/summary` reads `$session_end` events' `$duration_ms` property. Both
 *  are OUR OWN fixed reserved-name constants (contracts §4), never user input, so — matching how
 *  `infra/clickhouse/init.sql`'s `daily_sessions_mv` does it — they're embedded as SQL literals
 *  rather than bound params; only caller-supplied values ever need binding. */
const SESSION_END_EVENT = '$session_end';
const DURATION_MS_EXPR = "JSONExtractFloat(toJSONString(properties), '$duration_ms')";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  ) {}

  /**
   * Compiles + executes an insights query. Breakdown queries are 2-phase: first discover the top
   * `MAX_BREAKDOWN_VALUES` (insights.compiler.ts) values across all selected events, then run each
   * event's own bucketed series query restricted to those values. Raw events are queried directly
   * (not the rollup MVs) so results are exact — contracts §14's correctness note.
   */
  async runInsightsQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<InsightsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(insightsQuerySchema, body);
    const compiled = compileInsightsQuery(query, projectId);

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
      const rows = await this.clickhouse.query<SeriesRow>(seriesQuery.sql, params);

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
   * table). `search` is a distinct_id PREFIX match bound as a plain param to ClickHouse's
   * `startsWith(...)` — the caller's text is never concatenated into the SQL string, and
   * `startsWith` needs no `%`-wildcard massaging at all. Keyset-paginated by `distinct_id`
   * (`cursor` = the last id from the previous page): fetches one extra row to know whether a
   * `next_cursor` exists without a second COUNT query.
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

    const params: Record<string, unknown> = { projectId, limit: limit + 1 };
    const whereClauses = ['project_id = {projectId:UUID}'];
    if (searchRaw) {
      params.search = searchRaw;
      whereClauses.push('startsWith(distinct_id, {search:String})');
    }
    if (cursorRaw) {
      params.cursor = cursorRaw;
      whereClauses.push('distinct_id > {cursor:String}');
    }

    const rows = await this.clickhouse.query<UserRow>(
      `SELECT distinct_id, max(timestamp) AS last_seen, count(DISTINCT insert_id) AS event_count
       FROM events
       WHERE ${whereClauses.join('\n         AND ')}
       GROUP BY distinct_id
       ORDER BY distinct_id
       LIMIT {limit:UInt64}`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const users = page.map((row) => ({
      distinct_id: row.distinct_id,
      last_seen: fromChDateTime64(row.last_seen),
      event_count: Number(row.event_count),
    }));

    return { users, next_cursor: hasMore ? page[page.length - 1].distinct_id : null };
  }

  /**
   * GET /users/:distinctId — one user's profile + activity. `distinctId` is free-form
   * client-supplied text (not a UUID-shaped id like `projectId`), so it's always bound as
   * `{distinctId:String}`, never interpolated. The 3 lookups are independent of each other, so
   * they run concurrently; `Promise.all` still starts them in this fixed order, keeping mocked
   * `clickhouse.query` call sequences deterministic in tests. An unknown `distinctId` isn't a 404
   * — it just yields an empty profile / zero counts / no recent events, since it may simply be a
   * user with a profile op but zero events yet, or vice versa.
   */
  async getUserProfile(
    userId: string,
    projectId: string,
    distinctId: string,
  ): Promise<UserProfileResponse> {
    await this.projects.assertMembership(userId, projectId);

    const idParams = { projectId, distinctId };
    const [profileRows, aggRows, recentRows] = await Promise.all([
      this.clickhouse.query<ProfilePropertiesRow>(
        `SELECT properties
         FROM user_profiles FINAL
         WHERE project_id = {projectId:UUID}
           AND distinct_id = {distinctId:String}
         LIMIT 1`,
        idParams,
      ),
      this.clickhouse.query<UserAggRow>(
        `SELECT
           min(timestamp) AS first_seen,
           max(timestamp) AS last_seen,
           count(DISTINCT insert_id) AS event_count
         FROM events
         WHERE project_id = {projectId:UUID}
           AND distinct_id = {distinctId:String}`,
        idParams,
      ),
      this.clickhouse.query<RecentEventRow>(
        `SELECT insert_id, event, timestamp
         FROM events
         WHERE project_id = {projectId:UUID}
           AND distinct_id = {distinctId:String}
         ORDER BY timestamp DESC
         LIMIT 50`,
        idParams,
      ),
    ]);

    const eventCount = Number(aggRows[0]?.event_count ?? 0);
    // `min`/`max` over zero matching rows still return a (meaningless, epoch-default) row rather
    // than SQL NULL for a non-Nullable DateTime64 column — gate on the count, not the value.
    const firstSeen = eventCount > 0 ? fromChDateTime64(aggRows[0].first_seen) : null;
    const lastSeen = eventCount > 0 ? fromChDateTime64(aggRows[0].last_seen) : null;

    return {
      distinct_id: distinctId,
      profile: profileRows[0]?.properties ?? {},
      first_seen: firstSeen,
      last_seen: lastSeen,
      event_count: eventCount,
      recent_events: recentRows.map((row) => ({
        insert_id: row.insert_id,
        event: row.event,
        timestamp: fromChDateTime64(row.timestamp),
      })),
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
}
