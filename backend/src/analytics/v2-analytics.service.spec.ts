import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { ProjectsService } from '../projects/projects.service';
import { V2AnalyticsService } from './v2-analytics.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

/** `queryImpl` dispatches on the SQL text so multi-query methods get the right rows per call. */
function makeService(queryImpl: (sql: string) => unknown[]) {
  const query = jest.fn(async (sql: string) => queryImpl(sql));
  const clickhouse = { query } as unknown as ClickHouseService;
  const assertMembership = jest.fn().mockResolvedValue(undefined);
  const projects = { assertMembership } as unknown as ProjectsService;
  return { service: new V2AnalyticsService(clickhouse, projects), query, assertMembership };
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
  });
});
