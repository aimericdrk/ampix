import { Injectable } from '@nestjs/common';
import { ClickHouseService, fromChDateTime64 } from '../../clickhouse/clickhouse.service';
import { ProjectsService } from '../../projects/core/projects.service';
import type {
  LiveEventsResponse,
  UserProfileResponse,
  UsersResponse,
} from '../analytics.types';
import { ALIASES_CTE, canonicalization, RESOLVE_CANONICAL_ID_SQL } from '../support/identity';
import { clampLimit, parseEventSourceParam, parseIsoInstantParam } from '../support/read-query.util';
import { EVENT_SOURCE_EXPR } from '../support/property-resolver';
import { USER_SEARCH_PROFILE_KEYS } from './analytics.shared';

interface LiveEventRow {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  os: string;
  app_version: string;
  source: string;
}

interface UserRow {
  distinct_id: string;
  first_seen: string;
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
  properties: Record<string, unknown>;
  os: string;
  os_version: string;
  app_version: string;
  app_build: string;
  device_model: string;
  device_manufacturer: string;
  locale: string;
  timezone: string;
  network: string;
  sdk_version: string;
}

/**
 * `AnalyticsService`'s users endpoints (contracts §17): the live event feed, the users explorer
 * list, and a single user's merged profile. Split out of the former monolithic `AnalyticsService`
 * — see that file for the facade.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

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
    sourceRaw?: string,
  ): Promise<LiveEventsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const limit = clampLimit(limitRaw);
    const before = parseIsoInstantParam(beforeRaw, 'before');
    const source = parseEventSourceParam(sourceRaw);

    const params: Record<string, unknown> = { projectId, limit };
    let beforeClause = '';
    if (before !== undefined) {
      params.before = before;
      beforeClause = 'AND timestamp < {before:DateTime64}\n         ';
    }
    // EVENT_SOURCE_EXPR is a fixed constant (see property-resolver); the value binds as a param.
    let sourceClause = '';
    if (source !== undefined) {
      params.source = source;
      sourceClause = `AND ${EVENT_SOURCE_EXPR} = {source:String}\n         `;
    }

    const rows = await this.clickhouse.query<LiveEventRow>(
      `SELECT insert_id, event, distinct_id, timestamp, os, app_version,
              ${EVENT_SOURCE_EXPR} AS source
       FROM events
       WHERE project_id = {projectId:UUID}
         ${beforeClause}${sourceClause}ORDER BY timestamp DESC
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
      source: row.source,
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
              min(e.timestamp) AS first_seen,
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
      first_seen: fromChDateTime64(row.first_seen),
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
        // Same round-trip rule as ProfileWriter: without this, ClickHouse quotes 64-bit
        // integers in JSON output and numeric profile values come back as strings.
        { output_format_json_quote_64bit_integers: 0 },
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
                JSONExtractString(toJSONString(e.properties), '$screen_name') AS screen_name,
                e.properties AS properties,
                e.os AS os, e.os_version AS os_version, e.app_version AS app_version,
                e.app_build AS app_build, e.device_model AS device_model,
                e.device_manufacturer AS device_manufacturer, e.locale AS locale,
                e.timezone AS timezone, e.network AS network, e.sdk_version AS sdk_version
         FROM events AS e
         ${canon.join}
         WHERE e.project_id = {projectId:UUID}
           AND ${canon.uid} = {canonicalId:String}
         ORDER BY e.timestamp DESC
         LIMIT 50`,
        idParams,
        // canon.settings is REQUIRED for the canonicalizing LEFT JOIN; the 64-bit-integer
        // setting keeps numeric event properties as numbers (see the profile query above).
        { ...canon.settings, output_format_json_quote_64bit_integers: 0 },
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
        properties: row.properties ?? {},
        context: {
          os: row.os ?? '',
          os_version: row.os_version ?? '',
          app_version: row.app_version ?? '',
          app_build: row.app_build ?? '',
          device_model: row.device_model ?? '',
          device_manufacturer: row.device_manufacturer ?? '',
          locale: row.locale ?? '',
          timezone: row.timezone ?? '',
          network: row.network ?? '',
          sdk_version: row.sdk_version ?? '',
        },
      })),
      distinct_ids: distinctIds,
    };
  }
}
