import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { ProjectsService } from '../projects/core/projects.service';
import { V2AnalyticsService } from './v2-analytics.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

/** `queryImpl` dispatches on the SQL text so multi-query methods get the right rows per call. */
function makeService(queryImpl: (sql: string) => unknown[]) {
  const query = jest.fn(
    async (sql: string, _params?: Record<string, unknown>) => queryImpl(sql),
  );
  const clickhouse = { query } as unknown as ClickHouseService;
  const assertMembership = jest.fn().mockResolvedValue(undefined);
  const projects = { assertMembership } as unknown as ProjectsService;
  return { service: new V2AnalyticsService(clickhouse, projects), query, assertMembership };
}

/** feat-02 §3.4/T2: the `filters` query param is base64url(JSON.stringify(InsightsFilter[])). */
function encodeFilters(filters: unknown): string {
  return Buffer.from(JSON.stringify(filters)).toString('base64url');
}

describe('V2AnalyticsService', () => {
  describe('runClickHeatmap', () => {
    const body = {
      screen_name: 'checkout',
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      grid: { cols: 2, rows: 2 },
    };

    it('gates on membership, maps cells and sums total', async () => {
      const { service, assertMembership } = makeService(() => [
        { cx: 0, cy: 0, cnt: 3 },
        { cx: 1, cy: 1, cnt: 2 },
      ]);
      const res = await service.runClickHeatmap(USER, PROJECT, body);

      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(res).toEqual({
        screen_name: 'checkout',
        total: 5,
        cells: [
          { cx: 0, cy: 0, count: 3 },
          { cx: 1, cy: 1, count: 2 },
        ],
      });
    });

    it('empty result -> total 0, no cells', async () => {
      const { service } = makeService(() => []);
      const res = await service.runClickHeatmap(USER, PROJECT, body);
      expect(res).toEqual({ screen_name: 'checkout', total: 0, cells: [] });
    });
  });

  describe('runHistogram', () => {
    const body = {
      event: '$session_end',
      property: '$duration_ms',
      bins: 20,
      date_range: { from: '2026-06-01', to: '2026-07-01' },
    };

    it('gates on membership and maps the aggregate row (buckets + summary stats)', async () => {
      const { service, assertMembership } = makeService(() => [
        {
          buckets: [
            [0, 10, 3],
            [10, 20, 7.4],
          ],
          cnt: 10,
          mn: 1,
          mx: 19,
          avgVal: 12.5,
          p50: 11,
          p90: 18,
        },
      ]);

      const res = await service.runHistogram(USER, PROJECT, body);

      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(res).toEqual({
        buckets: [
          { lower: 0, upper: 10, count: 3 },
          { lower: 10, upper: 20, count: 7 }, // height rounded to a count
        ],
        total: 10,
        min: 1,
        max: 19,
        mean: 12.5,
        p50: 11,
        p90: 18,
      });
    });

    it('empty result (cnt=0) -> zeros/[] even if ClickHouse returns NaN-ish aggregates', async () => {
      const { service } = makeService(() => [
        { buckets: [], cnt: 0, mn: null, mx: null, avgVal: null, p50: null, p90: null },
      ]);
      const res = await service.runHistogram(USER, PROJECT, body);
      expect(res).toEqual({ buckets: [], total: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0 });
    });

    it('no rows at all -> zeros/[]', async () => {
      const { service } = makeService(() => []);
      const res = await service.runHistogram(USER, PROJECT, body);
      expect(res).toEqual({ buckets: [], total: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0 });
    });
  });

  describe('getEngagement', () => {
    // Two-day window; interval=day. active = new + returning; stickiness = active / MAU_range.
    const from = '2026-06-01';
    const to = '2026-06-02';
    const day1Ts = Date.UTC(2026, 5, 1) / 1000;
    const day2Ts = Date.UTC(2026, 5, 2) / 1000;

    it('assembles active / stickiness / new_vs_returning, zero-filling idle buckets', async () => {
      const { service } = makeService((sql) => {
        if (sql.includes('mau')) return [{ mau: 4 }];
        return [
          { bucket_ts: day1Ts, new_users: 3, returning_users: 0 },
          { bucket_ts: day2Ts, new_users: 1, returning_users: 2 },
        ];
      });

      const res = await service.getEngagement(USER, PROJECT, from, to, 'day');

      expect(res.active).toEqual([
        { t: '2026-06-01', metric: 'dau', value: 3 },
        { t: '2026-06-02', metric: 'dau', value: 3 },
      ]);
      expect(res.new_vs_returning).toEqual([
        { t: '2026-06-01', new: 3, returning: 0 },
        { t: '2026-06-02', new: 1, returning: 2 },
      ]);
      // stickiness = active / MAU_range (4): 3/4, 3/4.
      expect(res.stickiness).toEqual([
        { t: '2026-06-01', value: 0.75 },
        { t: '2026-06-02', value: 0.75 },
      ]);
    });

    it('zero-fills a bucket with no activity and guards MAU=0', async () => {
      const { service } = makeService((sql) => {
        if (sql.includes('mau')) return [{ mau: 0 }];
        return []; // no active users at all
      });
      const res = await service.getEngagement(USER, PROJECT, from, to, 'day');
      expect(res.active).toEqual([
        { t: '2026-06-01', metric: 'dau', value: 0 },
        { t: '2026-06-02', metric: 'dau', value: 0 },
      ]);
      expect(res.stickiness.every((p) => p.value === 0)).toBe(true);
    });

    // feat-02 §3.4/T2: an optional `filters` param AND-joins onto both the active/new-vs-returning
    // and the range-MAU queries — bound, injection-safe (reuses the shared filter-compiler).
    it('compiles a provided `filters` param into the active AND range-MAU queries, bound', async () => {
      const { service, query } = makeService((sql) => (sql.includes('mau') ? [{ mau: 0 }] : []));
      const filters = encodeFilters([{ property: 'os', op: 'eq', value: 'ios' }]);

      await service.getEngagement(USER, PROJECT, from, to, 'day', filters);

      expect(query.mock.calls).toHaveLength(2);
      for (const [sql, params] of query.mock.calls) {
        expect(sql).toContain('os = {filterVal0:String}');
        expect(params).toMatchObject({ filterVal0: 'ios' });
      }
    });

    it('an absent `filters` param leaves the query unchanged (no filter clause/param)', async () => {
      const { service, query } = makeService((sql) => (sql.includes('mau') ? [{ mau: 0 }] : []));

      await service.getEngagement(USER, PROJECT, from, to, 'day');

      for (const [sql, params] of query.mock.calls) {
        expect(sql).not.toContain('filterVal0');
        expect(params).not.toHaveProperty('filterVal0');
      }
    });

    it('INJECTION: a malicious filter value is only ever bound, never inlined', async () => {
      const { service, query } = makeService((sql) => (sql.includes('mau') ? [{ mau: 0 }] : []));
      const attack = "'; DROP TABLE events; --";
      const filters = encodeFilters([{ property: 'os', op: 'eq', value: attack }]);

      await service.getEngagement(USER, PROJECT, from, to, 'day', filters);

      for (const [sql, params] of query.mock.calls) {
        expect(sql).not.toContain(attack);
        expect(sql).not.toContain('DROP TABLE');
        expect(params).toMatchObject({ filterVal0: attack });
      }
    });

    it('a malformed `filters` param is a 400', async () => {
      const { service } = makeService(() => []);

      await expect(
        service.getEngagement(USER, PROJECT, from, to, 'day', 'not-valid-base64url-json'),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });
  });
});
