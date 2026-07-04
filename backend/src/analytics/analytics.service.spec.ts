import type { ClickHouseService } from '../clickhouse/clickhouse.service';
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

function makeService(clickhouse: unknown, projects: unknown) {
  return new AnalyticsService(clickhouse as ClickHouseService, projects as ProjectsService);
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
});
