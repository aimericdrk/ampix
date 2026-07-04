import { AdvancedAnalyticsService } from './advanced-analytics.service';
import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { ProjectsService } from '../projects/projects.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

function makeService(queryImpl: (sql: string) => unknown[]) {
  const query = jest.fn(async (sql: string) => queryImpl(sql));
  const clickhouse = { query } as unknown as ClickHouseService;
  const assertMembership = jest.fn().mockResolvedValue(undefined);
  const projects = { assertMembership } as unknown as ProjectsService;
  return { service: new AdvancedAnalyticsService(clickhouse, projects), query, assertMembership };
}

describe('AdvancedAnalyticsService', () => {
  describe('runFunnelQuery', () => {
    const body = {
      steps: [{ event: 'app_open' }, { event: 'signup_started' }, { event: 'checkout_completed' }],
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      window_days: 7,
    };

    it('gates on membership then derives exact conversions from the level counts', async () => {
      const { service, assertMembership } = makeService(() => [
        { step_0: 3, step_1: 2, step_2: 1 },
      ]);
      const res = await service.runFunnelQuery(USER, PROJECT, body);

      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(res).toEqual({
        steps: [
          { event: 'app_open', count: 3, conversion_from_prev: 1, conversion_from_top: 1 },
          { event: 'signup_started', count: 2, conversion_from_prev: 0.6667, conversion_from_top: 0.6667 },
          { event: 'checkout_completed', count: 1, conversion_from_prev: 0.5, conversion_from_top: 0.3333 },
        ],
        overall_conversion: 0.3333,
      });
    });

    it('guards divide-by-zero (empty funnel -> all rates 0)', async () => {
      const { service } = makeService(() => [{ step_0: 0, step_1: 0, step_2: 0 }]);
      const res = await service.runFunnelQuery(USER, PROJECT, body);
      expect(res.steps.map((s) => s.count)).toEqual([0, 0, 0]);
      expect(res.steps.map((s) => s.conversion_from_prev)).toEqual([1, 0, 0]);
      expect(res.overall_conversion).toBe(0);
    });

    it('breakdown: one funnel per value, top 10 kept, tail folded into $other', async () => {
      // 11 breakdown values (already ordered by step_0 desc as the SQL guarantees).
      const rows = Array.from({ length: 11 }, (_, i) => ({
        breakdown_value: `v${i}`,
        step_0: 20 - i,
        step_1: 10 - Math.floor(i / 2),
      }));
      const { service } = makeService(() => rows);
      const res = await service.runFunnelQuery(USER, PROJECT, {
        ...body,
        steps: [{ event: 'app_open' }, { event: 'signup_started' }],
        breakdown: { property: 'os' },
      });

      expect(res.breakdowns).toBeDefined();
      // 10 kept + 1 folded $other.
      expect(res.breakdowns).toHaveLength(11);
      const other = res.breakdowns!.find((b) => b.value === '$other')!;
      // Only v10 is folded: step_0 = 20-10 = 10, step_1 = 10 - 5 = 5.
      expect(other.steps[0].count).toBe(10);
      expect(other.steps[1].count).toBe(5);
    });

    it('400 on an invalid body (too few steps)', async () => {
      const { service } = makeService(() => []);
      await expect(
        service.runFunnelQuery(USER, PROJECT, { ...body, steps: [{ event: 'only_one' }] }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });
  });

  describe('runRetentionQuery', () => {
    const body = {
      born_event: { name: 'signup_completed' },
      date_range: { from: '2026-06-01', to: '2026-06-10' },
      interval: 'day',
      periods: 5,
    };

    function retentionImpl(sql: string): unknown[] {
      if (sql.includes('AS size')) {
        return [
          { cohort: '2026-06-01', size: 10 },
          { cohort: '2026-06-09', size: 4 },
        ];
      }
      return [
        { cohort: '2026-06-01', period: 1, cnt: 6 },
        { cohort: '2026-06-01', period: 2, cnt: 3 },
        { cohort: '2026-06-09', period: 1, cnt: 2 },
      ];
    }

    it('builds cohorts with period 0 == size, exact rates, and trims un-elapsed periods', async () => {
      const { service } = makeService(retentionImpl);
      const res = await service.runRetentionQuery(USER, PROJECT, body);

      const c1 = res.cohorts.find((c) => c.cohort === '2026-06-01')!;
      expect(c1.size).toBe(10);
      expect(c1.periods).toEqual([
        { period: 0, count: 10, rate: 1 },
        { period: 1, count: 6, rate: 0.6 },
        { period: 2, count: 3, rate: 0.3 },
        { period: 3, count: 0, rate: 0 },
        { period: 4, count: 0, rate: 0 },
        { period: 5, count: 0, rate: 0 },
      ]);

      // Cohort born 06-09: only 2 full days elapse by 06-10 (to) -> exposes periods 0..1 only.
      const c2 = res.cohorts.find((c) => c.cohort === '2026-06-09')!;
      expect(c2.periods).toEqual([
        { period: 0, count: 4, rate: 1 },
        { period: 1, count: 2, rate: 0.5 },
      ]);
    });

    it('averages are size-weighted per period (only over cohorts exposing that period)', async () => {
      const { service } = makeService(retentionImpl);
      const res = await service.runRetentionQuery(USER, PROJECT, body);
      expect(res.averages).toEqual([
        { period: 0, rate: 1 }, // (10+4)/(10+4)
        { period: 1, rate: 0.5714 }, // (6+2)/(10+4)
        { period: 2, rate: 0.3 }, // only 06-01 exposes p2: 3/10
        { period: 3, rate: 0 },
        { period: 4, rate: 0 },
        { period: 5, rate: 0 },
      ]);
    });

    it('400 on periods out of range', async () => {
      const { service } = makeService(() => []);
      await expect(
        service.runRetentionQuery(USER, PROJECT, { ...body, periods: 99 }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });
  });

  describe('runFlowQuery', () => {
    it('gates on membership and delegates the fold to buildFlowGraph', async () => {
      const { service, assertMembership } = makeService(() => [
        { did: 'u1', seq: [[0, 'home', 1], [1, 'browse', 0]] },
      ]);
      const res = await service.runFlowQuery(USER, PROJECT, {
        anchor: { event: 'home' },
        date_range: { from: '2026-06-01', to: '2026-07-01' },
        steps: 1,
        max_nodes_per_step: 8,
        unit: 'user',
      });
      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(res.nodes.find((n) => n.id === '0:home')?.value).toBe(1);
      expect(res.links.find((l) => l.source === '0:home' && l.target === '1:browse')?.value).toBe(1);
    });

    it('400 on an unknown direction', async () => {
      const { service } = makeService(() => []);
      await expect(
        service.runFlowQuery(USER, PROJECT, {
          anchor: { event: 'home' },
          direction: 'sideways',
          date_range: { from: '2026-06-01', to: '2026-07-01' },
          steps: 1,
          max_nodes_per_step: 8,
        }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });
  });
});
