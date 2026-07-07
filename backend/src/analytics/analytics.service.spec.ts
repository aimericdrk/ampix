import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { CohortsService } from '../cohorts/cohorts.service';
import type { ProjectsService } from '../projects/projects.service';
import { AnalyticsService } from './analytics.service';

const USER_ID = 'user-1';
const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function makeClickhouse(responses: unknown[][] = []) {
  const query = jest.fn();
  responses.forEach((rows) => query.mockResolvedValueOnce(rows));
  return { query };
}

function makeProjects(assertMembershipImpl?: () => Promise<void>) {
  return { assertMembership: jest.fn(assertMembershipImpl ?? (() => Promise.resolve())) };
}

function makeService(clickhouse: unknown, projects: unknown, cohorts?: unknown) {
  return new AnalyticsService(
    clickhouse as ClickHouseService,
    projects as ProjectsService,
    (cohorts ?? { resolveCohortPredicate: jest.fn() }) as CohortsService,
  );
}

function validInsightsBody(overrides: Record<string, unknown> = {}) {
  return {
    events: [{ name: 'checkout_completed', aggregation: 'total' }],
    date_range: { from: '2026-06-01', to: '2026-06-02' },
    interval: 'day',
    ...overrides,
  };
}

describe('AnalyticsService', () => {
  describe('runInsightsQuery', () => {
    it('checks membership before doing anything else, and propagates a membership rejection without querying ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const service = makeService(clickhouse, projects);

      await expect(
        service.runInsightsQuery(USER_ID, PROJECT_ID, validInsightsBody()),
      ).rejects.toMatchObject({ problem: { status: 403 } });
      expect(projects.assertMembership).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
      expect(clickhouse.query).not.toHaveBeenCalled();
    });

    it('rejects an invalid body with a 400 before touching ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      await expect(
        service.runInsightsQuery(USER_ID, PROJECT_ID, { events: [] }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });

    it('no breakdown: runs one query per event and zero-fills the response onto the bucket grid', async () => {
      const clickhouse = makeClickhouse([
        // Only day 1 has data; day 2 must still appear, zero-filled.
        [{ bucket_ts: Date.UTC(2026, 5, 1) / 1000, value: '3' }],
      ]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.runInsightsQuery(USER_ID, PROJECT_ID, validInsightsBody());

      expect(clickhouse.query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        series: [
          {
            name: 'checkout_completed',
            breakdown_value: null,
            data: [
              { t: '2026-06-01', value: 3 },
              { t: '2026-06-02', value: 0 },
            ],
          },
        ],
      });
    });

    it('multi-event: runs one query per event and returns one series per event, in order', async () => {
      const clickhouse = makeClickhouse([
        [{ bucket_ts: Date.UTC(2026, 5, 1) / 1000, value: 5 }],
        [{ bucket_ts: Date.UTC(2026, 5, 2) / 1000, value: 2 }],
      ]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.runInsightsQuery(
        USER_ID,
        PROJECT_ID,
        validInsightsBody({
          events: [
            { name: 'checkout_completed', aggregation: 'total' },
            { name: 'product_viewed', aggregation: 'unique_users' },
          ],
        }),
      );

      expect(clickhouse.query).toHaveBeenCalledTimes(2);
      expect(result.series).toHaveLength(2);
      expect(result.series[0]).toMatchObject({ name: 'checkout_completed' });
      expect(result.series[1]).toMatchObject({ name: 'product_viewed' });
    });

    it('breakdown: runs the top-values query first, then one series per (event x breakdown value)', async () => {
      const clickhouse = makeClickhouse([
        // topBreakdownValuesQuery
        [
          { breakdown_value: 'ios', total: 10 },
          { breakdown_value: 'android', total: 8 },
        ],
        // the single event's series query, both breakdown values mixed together
        [
          { bucket_ts: Date.UTC(2026, 5, 1) / 1000, breakdown_value: 'ios', value: 6 },
          { bucket_ts: Date.UTC(2026, 5, 1) / 1000, breakdown_value: 'android', value: 4 },
          { bucket_ts: Date.UTC(2026, 5, 2) / 1000, breakdown_value: 'ios', value: 4 },
        ],
      ]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.runInsightsQuery(
        USER_ID,
        PROJECT_ID,
        validInsightsBody({ breakdown: { property: 'os' } }),
      );

      expect(clickhouse.query).toHaveBeenCalledTimes(2);
      // Second call must have been given the discovered breakdown values to bind.
      expect(clickhouse.query.mock.calls[1][1]).toMatchObject({
        breakdownValues: ['ios', 'android'],
      });

      expect(result.series).toEqual([
        {
          name: 'checkout_completed',
          breakdown_value: 'ios',
          data: [
            { t: '2026-06-01', value: 6 },
            { t: '2026-06-02', value: 4 },
          ],
        },
        {
          name: 'checkout_completed',
          breakdown_value: 'android',
          data: [
            { t: '2026-06-01', value: 4 },
            { t: '2026-06-02', value: 0 },
          ],
        },
      ]);
    });

    it('breakdown with no matching data: top-values query returns [] -> no series at all', async () => {
      const clickhouse = makeClickhouse([[]]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.runInsightsQuery(
        USER_ID,
        PROJECT_ID,
        validInsightsBody({ breakdown: { property: 'os' } }),
      );

      // Only the top-values query ran; there are no breakdown values to fan out per-event queries into.
      expect(clickhouse.query).toHaveBeenCalledTimes(2);
      expect(result.series).toEqual([]);
    });
  });

  describe('listEventNames', () => {
    it('checks membership, queries distinct events scoped to the project + 30d window, and unwraps rows', async () => {
      const clickhouse = makeClickhouse([
        [{ event: 'checkout_completed' }, { event: 'product_viewed' }],
      ]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.listEventNames(USER_ID, PROJECT_ID);

      expect(projects.assertMembership).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
      expect(clickhouse.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT event'),
        expect.objectContaining({ projectId: PROJECT_ID }),
      );
      expect(result).toEqual({ events: ['checkout_completed', 'product_viewed'] });
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 404 } })),
      );
      const service = makeService(clickhouse, projects);

      await expect(service.listEventNames(USER_ID, PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('listProperties', () => {
    it('combines whitelisted columns (type "column") with distinct custom JSON keys (type "string")', async () => {
      const clickhouse = makeClickhouse([[{ key: 'plan' }, { key: 'value' }]]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.listProperties(USER_ID, PROJECT_ID);

      expect(result.properties).toEqual(
        expect.arrayContaining([
          { name: 'os', type: 'column' },
          { name: 'distinct_id', type: 'column' },
          { name: 'plan', type: 'string' },
          { name: 'value', type: 'string' },
        ]),
      );
      // No event filter -> no eventName param, no `AND event =` clause.
      const [, params] = clickhouse.query.mock.calls[0];
      expect(params.eventName).toBeUndefined();
    });

    it('narrows the custom-key scan to one event name when `event` is given, bound as a param', async () => {
      const clickhouse = makeClickhouse([[{ key: 'plan' }]]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      await service.listProperties(USER_ID, PROJECT_ID, 'checkout_completed');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('AND event = {eventName:String}');
      expect(params).toMatchObject({ eventName: 'checkout_completed' });
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const service = makeService(clickhouse, projects);

      await expect(service.listProperties(USER_ID, PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('listPropertyValues', () => {
    it('binds a custom property key as {propKey:String} and never interpolates it', async () => {
      const clickhouse = makeClickhouse([[{ value: 'free' }, { value: 'pro' }]]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.listPropertyValues(USER_ID, PROJECT_ID, 'plan');

      expect(result).toEqual({ values: ['free', 'pro'] });
      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('JSONExtractString(toJSONString(properties), {propKey:String})');
      expect(sql).not.toContain('plan');
      expect(params).toMatchObject({ propKey: 'plan' });
      // Frequency-ranked, empties excluded, capped by the bound limit param.
      expect(sql).toContain("!= ''");
      expect(sql).toContain('ORDER BY cnt DESC, value ASC');
      expect(sql).toContain('LIMIT {limit:UInt64}');
      expect(params.limit).toBe(50);
      // No event filter -> no eventName param.
      expect(params.eventName).toBeUndefined();
    });

    it('emits a whitelisted column as a bare literal WITHOUT a propKey param', async () => {
      const clickhouse = makeClickhouse([[{ value: 'ios' }, { value: 'android' }]]);
      const service = makeService(clickhouse, makeProjects());

      await service.listPropertyValues(USER_ID, PROJECT_ID, 'os');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('SELECT os AS value');
      expect(params.propKey).toBeUndefined();
    });

    it('narrows to one event and clamps the limit, both bound as params', async () => {
      const clickhouse = makeClickhouse([[{ value: 'free' }]]);
      const service = makeService(clickhouse, makeProjects());

      await service.listPropertyValues(USER_ID, PROJECT_ID, 'plan', 'checkout_completed', '1000');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('AND event = {eventName:String}');
      expect(params).toMatchObject({ eventName: 'checkout_completed', limit: 200 });
    });

    it('rejects an absent or blank property with a 400 without querying ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const service = makeService(clickhouse, makeProjects());

      await expect(service.listPropertyValues(USER_ID, PROJECT_ID, undefined)).rejects.toMatchObject(
        { problem: { status: 400 } },
      );
      await expect(service.listPropertyValues(USER_ID, PROJECT_ID, '')).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const service = makeService(clickhouse, projects);

      await expect(
        service.listPropertyValues(USER_ID, PROJECT_ID, 'plan'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('getLiveEvents', () => {
    function row(overrides: Record<string, unknown> = {}) {
      return {
        insert_id: 'i1',
        event: 'checkout_completed',
        distinct_id: 'u1',
        timestamp: '2026-06-01 12:00:00.000',
        os: 'ios',
        app_version: '1.0.0',
        ...overrides,
      };
    }

    it('checks membership, maps rows, and derives next_before from the last row', async () => {
      const clickhouse = makeClickhouse([
        [
          row({ timestamp: '2026-06-01 12:00:00.500' }),
          row({ insert_id: 'i2', timestamp: '2026-06-01 11:00:00.000' }),
        ],
      ]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.getLiveEvents(USER_ID, PROJECT_ID);

      expect(projects.assertMembership).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
      expect(result.events).toEqual([
        {
          insert_id: 'i1',
          event: 'checkout_completed',
          distinct_id: 'u1',
          timestamp: '2026-06-01T12:00:00.500Z',
          os: 'ios',
          app_version: '1.0.0',
        },
        {
          insert_id: 'i2',
          event: 'checkout_completed',
          distinct_id: 'u1',
          timestamp: '2026-06-01T11:00:00.000Z',
          os: 'ios',
          app_version: '1.0.0',
        },
      ]);
      // next_before = the LAST returned row's timestamp, not the first.
      expect(result.next_before).toBe('2026-06-01T11:00:00.000Z');
    });

    it('next_before is null when the page is empty', async () => {
      const clickhouse = makeClickhouse([[]]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.getLiveEvents(USER_ID, PROJECT_ID);

      expect(result.events).toEqual([]);
      expect(result.next_before).toBeNull();
    });

    it('binds the (clamped) limit and omits the before clause when before is absent', async () => {
      const clickhouse = makeClickhouse([[]]);
      const service = makeService(clickhouse, makeProjects());

      await service.getLiveEvents(USER_ID, PROJECT_ID, '9999');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).not.toContain('before');
      expect(params).toEqual({ projectId: PROJECT_ID, limit: 100 }); // clamped to MAX_LIMIT
    });

    it('binds `before` as a param (never string-interpolated) when present', async () => {
      const clickhouse = makeClickhouse([[]]);
      const service = makeService(clickhouse, makeProjects());

      await service.getLiveEvents(USER_ID, PROJECT_ID, '10', '2026-06-01T00:00:00.000Z');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('{before:DateTime64}');
      expect(sql).not.toContain('2026-06-01T00:00:00.000Z');
      expect(params).toMatchObject({ before: '2026-06-01 00:00:00.000', limit: 10 });
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const clickhouse = makeClickhouse();
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const service = makeService(clickhouse, projects);

      await expect(service.getLiveEvents(USER_ID, PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    it('checks membership and maps rows to the users-list shape', async () => {
      const clickhouse = makeClickhouse([
        [{ distinct_id: 'u1', last_seen: '2026-06-01 12:00:00.000', event_count: '5' }],
      ]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.listUsers(USER_ID, PROJECT_ID);

      expect(result.users).toEqual([
        { distinct_id: 'u1', last_seen: '2026-06-01T12:00:00.000Z', event_count: 5 },
      ]);
      expect(result.next_cursor).toBeNull();
    });

    it('binds `search` as a plain param value — the caller text is never concatenated into the SQL', async () => {
      const clickhouse = makeClickhouse([[]]);
      const service = makeService(clickhouse, makeProjects());

      await service.listUsers(USER_ID, PROJECT_ID, "u1'; DROP TABLE events; --");

      const [sql, params] = clickhouse.query.mock.calls[0];
      // §17: search matches the CANONICAL id prefix, still a bound param.
      expect(sql).toContain(
        'startsWith(coalesce(aliases.canonical_id, e.distinct_id), {search:String})',
      );
      expect(sql).not.toContain('DROP TABLE');
      expect(params).toMatchObject({ search: "u1'; DROP TABLE events; --" });
    });

    it('groups/counts by the canonical `uid` and runs under join_use_nulls=1 (contracts §17)', async () => {
      const clickhouse = makeClickhouse([[]]);
      const service = makeService(clickhouse, makeProjects());

      await service.listUsers(USER_ID, PROJECT_ID);

      const [sql, , settings] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('WITH aliases AS (');
      expect(sql).toContain('LEFT JOIN aliases ON e.distinct_id = aliases.anon_id');
      expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id) AS distinct_id');
      expect(sql).toContain('GROUP BY coalesce(aliases.canonical_id, e.distinct_id)');
      expect(settings).toEqual({ join_use_nulls: 1 });
    });

    it('omits the search clause entirely when search is not given', async () => {
      const clickhouse = makeClickhouse([[]]);
      const service = makeService(clickhouse, makeProjects());

      await service.listUsers(USER_ID, PROJECT_ID);

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).not.toContain('startsWith');
      expect(params.search).toBeUndefined();
    });

    it('binds cursor and paginates: fetching limit+1 rows to compute next_cursor', async () => {
      const clickhouse = makeClickhouse([
        [
          { distinct_id: 'u1', last_seen: '2026-06-01 12:00:00.000', event_count: 1 },
          { distinct_id: 'u2', last_seen: '2026-06-01 12:00:00.000', event_count: 1 },
        ],
      ]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.listUsers(USER_ID, PROJECT_ID, undefined, '1', 'u0');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id) > {cursor:String}');
      expect(params).toMatchObject({ cursor: 'u0', limit: 2 }); // limit(1) + 1 lookahead row
      // Only `limit` (1) users are returned; the lookahead row becomes next_cursor, not a 3rd user.
      expect(result.users).toHaveLength(1);
      expect(result.next_cursor).toBe('u1');
    });

    it('next_cursor is null when fewer rows than limit come back (no more pages)', async () => {
      const clickhouse = makeClickhouse([
        [{ distinct_id: 'u1', last_seen: '2026-06-01 12:00:00.000', event_count: 1 }],
      ]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.listUsers(USER_ID, PROJECT_ID, undefined, '50');

      expect(result.next_cursor).toBeNull();
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const clickhouse = makeClickhouse();
      const service = makeService(clickhouse, projects);

      await expect(service.listUsers(USER_ID, PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('getUserProfile', () => {
    const DISTINCT_ID = 'u1';

    it('resolves the id, then combines the canonical profile + aggregate + recent-events rows', async () => {
      const clickhouse = makeClickhouse([
        // 1) identity resolution: `u1` is already canonical (no alias row) -> '' -> falls back to u1.
        [{ canonical_id: '' }],
        [{ properties: { plan: 'pro' } }],
        [
          {
            first_seen: '2026-06-01 09:00:00.000',
            last_seen: '2026-06-02 09:00:00.000',
            event_count: '3',
          },
        ],
        [
          { insert_id: 'i2', event: '$screen_view', timestamp: '2026-06-02 09:00:00.000', screen_name: 'home' },
          { insert_id: 'i1', event: 'a', timestamp: '2026-06-01 09:00:00.000', screen_name: '' },
        ],
        // 5) aliases lookup: one anon_id aliases to this canonical user.
        [{ anon_id: 'anon-u1' }],
      ]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.getUserProfile(USER_ID, PROJECT_ID, DISTINCT_ID);

      // 1 resolution query + 4 data queries (profile, agg, recent, aliases).
      expect(clickhouse.query).toHaveBeenCalledTimes(5);
      // The resolution query binds the requested id as {distinctId:String} (never interpolated).
      const [resolveSql, resolveParams] = clickhouse.query.mock.calls[0];
      expect(resolveSql).toContain('{distinctId:String}');
      expect(resolveParams).toMatchObject({ distinctId: DISTINCT_ID });
      // The data queries key off the resolved canonical id (here == u1) as {canonicalId:String}.
      for (const [sql, params] of clickhouse.query.mock.calls.slice(1)) {
        expect(sql).toContain('{canonicalId:String}');
        expect(params).toMatchObject({ canonicalId: DISTINCT_ID });
      }
      expect(result).toEqual({
        distinct_id: DISTINCT_ID,
        profile: { plan: 'pro' },
        first_seen: '2026-06-01T09:00:00.000Z',
        last_seen: '2026-06-02T09:00:00.000Z',
        event_count: 3,
        recent_events: [
          { insert_id: 'i2', event: '$screen_view', timestamp: '2026-06-02T09:00:00.000Z', screen_name: 'home' },
          { insert_id: 'i1', event: 'a', timestamp: '2026-06-01T09:00:00.000Z', screen_name: null },
        ],
        // §17 identity set: the canonical id plus its aliased anon_id.
        distinct_ids: [DISTINCT_ID, 'anon-u1'],
      });
    });

    it("resolves an anon_id to its canonical user and returns THAT user's merged profile (§17)", async () => {
      const clickhouse = makeClickhouse([
        // 1) resolution: the requested `anon_x` aliases to canonical user `user_42`.
        [{ canonical_id: 'user_42' }],
        [{ properties: { plan: 'pro' } }],
        [
          {
            first_seen: '2026-06-01 09:00:00.000',
            last_seen: '2026-06-02 09:00:00.000',
            event_count: '6',
          },
        ],
        [],
        // 5) aliases: `anon_x` is one of the anon_ids folding into canonical user_42.
        [{ anon_id: 'anon_x' }],
      ]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.getUserProfile(USER_ID, PROJECT_ID, 'anon_x');

      // The response is keyed by the canonical id, and the data queries filter on it.
      expect(result.distinct_id).toBe('user_42');
      expect(result.event_count).toBe(6);
      // §17 identity set: canonical id + its aliased anon_id, for the identity-correct per-user heatmap.
      expect(result.distinct_ids).toEqual(['user_42', 'anon_x']);
      for (const [, params] of clickhouse.query.mock.calls.slice(1)) {
        expect(params).toMatchObject({ canonicalId: 'user_42' });
      }
      // The event lookups canonicalize via the alias map under join_use_nulls=1.
      const [aggSql, , aggSettings] = clickhouse.query.mock.calls[2];
      expect(aggSql).toContain('LEFT JOIN aliases ON e.distinct_id = aliases.anon_id');
      expect(aggSql).toContain(
        'coalesce(aliases.canonical_id, e.distinct_id) = {canonicalId:String}',
      );
      expect(aggSettings).toEqual({ join_use_nulls: 1 });
    });

    it('empty profile -> {} (never null/undefined), and unknown user -> null seens + zero count', async () => {
      const clickhouse = makeClickhouse([
        [{ canonical_id: '' }],
        [],
        [
          {
            first_seen: '1970-01-01 00:00:00.000',
            last_seen: '1970-01-01 00:00:00.000',
            event_count: '0',
          },
        ],
        [],
        // 5) aliases: an unknown user has no anon_ids folding into it.
        [],
      ]);
      const service = makeService(clickhouse, makeProjects());

      const result = await service.getUserProfile(USER_ID, PROJECT_ID, 'ghost');

      expect(result.distinct_id).toBe('ghost');
      expect(result.profile).toEqual({});
      expect(result.first_seen).toBeNull();
      expect(result.last_seen).toBeNull();
      expect(result.event_count).toBe(0);
      expect(result.recent_events).toEqual([]);
      // With no aliases, the identity set is just the (unknown) id itself.
      expect(result.distinct_ids).toEqual(['ghost']);
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const clickhouse = makeClickhouse();
      const service = makeService(clickhouse, projects);

      await expect(service.getUserProfile(USER_ID, PROJECT_ID, DISTINCT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('getSessionsSummary', () => {
    it('checks membership, reads $session_end/$duration_ms, and zero-fills by_day onto the date grid', async () => {
      const clickhouse = makeClickhouse([
        [{ sessions: '3', avg_duration_ms: 2000 }],
        [{ day: '2026-06-01', sessions: '2', avg_duration_ms: 1500 }],
      ]);
      const projects = makeProjects();
      const service = makeService(clickhouse, projects);

      const result = await service.getSessionsSummary(
        USER_ID,
        PROJECT_ID,
        '2026-06-01',
        '2026-06-02',
      );

      expect(projects.assertMembership).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
      expect(result.sessions).toBe(3);
      expect(result.avg_duration_ms).toBe(2000);
      expect(result.by_day).toEqual([
        { t: '2026-06-01', sessions: 2, avg_duration_ms: 1500 },
        { t: '2026-06-02', sessions: 0, avg_duration_ms: 0 }, // zero-filled: no matching row
      ]);
    });

    it('the $session_end / $duration_ms references are fixed literals, not bound params (not user input)', async () => {
      const clickhouse = makeClickhouse([[{ sessions: 0, avg_duration_ms: 0 }], []]);
      const service = makeService(clickhouse, makeProjects());

      await service.getSessionsSummary(USER_ID, PROJECT_ID, '2026-06-01', '2026-06-01');

      const [sql, params] = clickhouse.query.mock.calls[0];
      expect(sql).toContain("'$session_end'");
      expect(sql).toContain("'$duration_ms'");
      expect(params).not.toHaveProperty('event');
      expect(params).not.toHaveProperty('durationKey');
    });

    it('defaults to the trailing 30-day window when from/to are omitted', async () => {
      const clickhouse = makeClickhouse([[{ sessions: 0, avg_duration_ms: 0 }], []]);
      const service = makeService(clickhouse, makeProjects());

      await service.getSessionsSummary(USER_ID, PROJECT_ID);

      expect(clickhouse.query).toHaveBeenCalledTimes(2);
    });

    it('propagates a membership rejection without querying ClickHouse', async () => {
      const projects = makeProjects(() =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      );
      const clickhouse = makeClickhouse();
      const service = makeService(clickhouse, projects);

      await expect(
        service.getSessionsSummary(USER_ID, PROJECT_ID, '2026-06-01', '2026-06-02'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });
});
