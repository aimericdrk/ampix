import { RcMetricsService } from './rc-metrics.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';

/** feat-02 §3.4/T2: the `filters` query param is base64url(JSON.stringify(InsightsFilter[])). */
function encodeFilters(filters: unknown): string {
  return Buffer.from(JSON.stringify(filters)).toString('base64url');
}

function build({ integration = { id: 'int-1' } as unknown }: { integration?: unknown } = {}) {
  const prisma = {
    revenueCatIntegration: { findUnique: jest.fn(async () => integration) },
    subscriptionState: {
      groupBy: jest.fn(async ({ by }: any) =>
        by[0] === 'status'
          ? [
              { status: 'active', _count: { _all: 5 }, _sum: { mrrCents: 4995 } },
              { status: 'trial', _count: { _all: 2 }, _sum: { mrrCents: 0 } },
            ]
          : by[0] === 'productId'
            ? [{ productId: 'pro_monthly', _count: { _all: 5 }, _sum: { mrrCents: 4995 } }]
            : [{ store: 'APP_STORE', _count: { _all: 5 } }],
      ),
    },
  } as any;
  const clickhouse = { query: jest.fn(async () => []) } as any;
  const projects = { assertMembership: jest.fn(async () => undefined) } as any;
  return { prisma, clickhouse, projects, svc: new RcMetricsService(prisma, clickhouse, projects) };
}

describe('RcMetricsService.getSummary', () => {
  it('404s when the project has no integration', async () => {
    const { svc } = build({ integration: null });
    await expect(svc.getSummary('u1', PID)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('asserts membership and aggregates state KPIs from Postgres', async () => {
    const { svc, projects } = build();
    const s = await svc.getSummary('u1', PID);
    expect(projects.assertMembership).toHaveBeenCalledWith('u1', PID);
    expect(s.active).toBe(5);
    expect(s.in_trial).toBe(2);
    expect(s.grace).toBe(0);
    expect(s.mrr_cents).toBe(4995);
    expect(s.by_product).toEqual([{ product_id: 'pro_monthly', active: 5, mrr_cents: 4995 }]);
    expect(s.by_store).toEqual([{ store: 'APP_STORE', active: 5 }]);
  });

  it('propagates a membership rejection without touching Postgres/ClickHouse', async () => {
    const { prisma, clickhouse, svc } = build();
    (prisma.subscriptionState.groupBy as jest.Mock).mockClear();
    const projects = { assertMembership: jest.fn(async () => Promise.reject(
      Object.assign(new Error('x'), { problem: { status: 403 } }),
    )) };
    const rejecting = new RcMetricsService(prisma, clickhouse, projects as any);
    await expect(rejecting.getSummary('u1', PID)).rejects.toMatchObject({
      problem: { status: 403 },
    });
    expect(prisma.revenueCatIntegration.findUnique).not.toHaveBeenCalled();
    expect(clickhouse.query).not.toHaveBeenCalled();
  });

  it('binds project + range params on every CH query and never interpolates', async () => {
    const { svc, clickhouse } = build();
    await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10');
    expect(clickhouse.query.mock.calls.length).toBeGreaterThan(0);
    for (const [sql, params] of clickhouse.query.mock.calls) {
      expect(sql).toContain('{projectId:UUID}');
      expect(params.projectId).toBe(PID);
    }
  });

  it('the $rc_* event/property literals are fixed, not bound params', async () => {
    const { svc, clickhouse } = build();
    await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10');
    const allSql = clickhouse.query.mock.calls.map(([sql]: [string]) => sql).join('\n');
    expect(allSql).toContain('$rc_initial_purchase');
    expect(allSql).toContain('$rc_expiration');
    expect(allSql).toContain('$rc_renewal');
  });

  it('excludes the $rc_link identity event from the recent_events and by_day lifecycle scans', async () => {
    const { svc, clickhouse } = build();
    await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10');
    // The two `$rc_%` lifecycle scans are the only ones combining the LIKE with a LIMIT
    // (recent_events) or a `GROUP BY t` (by_day); both must exclude the contentless identity event.
    const lifecycleScans = clickhouse.query.mock.calls
      .map(([sql]: [string]) => sql)
      .filter((sql: string) => sql.includes("event LIKE '$rc\\_%'"));
    expect(lifecycleScans.length).toBe(2);
    for (const sql of lifecycleScans) {
      expect(sql).toContain("event != '$rc_link'");
    }
  });

  it('compiles a provided `filters` param into the new_subscriptions/trials and by_day queries only, bound', async () => {
    const { svc, clickhouse } = build();
    const filters = encodeFilters([{ property: 'os', op: 'eq', value: 'ios' }]);

    await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10', filters);

    const calls = clickhouse.query.mock.calls as Array<[string, Record<string, unknown>]>;
    const withFilter = calls.filter(([sql]) => sql.includes('filterVal0'));
    const withoutFilter = calls.filter(([sql]) => !sql.includes('filterVal0'));
    expect(withFilter.length).toBeGreaterThan(0);
    expect(withoutFilter.length).toBeGreaterThan(0);
    for (const [sql, params] of withFilter) {
      expect(sql).toContain('os = {filterVal0:String}');
      expect(params).toMatchObject({ filterVal0: 'ios' });
    }
  });

  it('a malformed `filters` param is a 400 before touching ClickHouse', async () => {
    const { svc, clickhouse } = build();
    await expect(
      svc.getSummary('u1', PID, '2026-07-01', '2026-07-10', 'not-valid-base64url-json'),
    ).rejects.toMatchObject({ problem: { status: 400 } });
    expect(clickhouse.query).not.toHaveBeenCalled();
  });

  it('defaults to the trailing 30-day window when from/to are omitted', async () => {
    const { svc, clickhouse } = build();
    await svc.getSummary('u1', PID);
    expect(clickhouse.query).toHaveBeenCalled();
  });

  it('maps CH rows into the response contract (new_subscriptions/churned/trials/by_day/churn_reasons/recent_events)', async () => {
    const { svc, clickhouse } = build();
    (clickhouse.query as jest.Mock)
      .mockResolvedValueOnce([{ subs: 3, trials: 1 }])
      .mockResolvedValueOnce([{ churned: 2 }])
      .mockResolvedValueOnce([{ converted: 1 }])
      .mockResolvedValueOnce([
        { t: '2026-07-01', new_subscriptions: 2, churned: 1, revenue: 19.98 },
      ])
      .mockResolvedValueOnce([{ reason: 'PRICE_CHANGE', count: 2 }])
      .mockResolvedValueOnce([
        {
          insert_id: 'ev-1',
          event: '$rc_initial_purchase',
          distinct_id: 'd1',
          timestamp: '2026-07-01 00:00:00.000',
          product_id: 'pro_monthly',
          price: 9.99,
        },
      ]);

    const s = await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10');

    expect(s.new_subscriptions).toBe(3);
    expect(s.trials_started).toBe(1);
    expect(s.churned).toBe(2);
    expect(s.trials_converted).toBe(1);
    expect(s.by_day).toEqual([
      { t: '2026-07-01', new_subscriptions: 2, churned: 1, revenue: 19.98 },
    ]);
    expect(s.churn_reasons).toEqual([{ reason: 'PRICE_CHANGE', count: 2 }]);
    expect(s.recent_events).toEqual([
      {
        insert_id: 'ev-1',
        event: '$rc_initial_purchase',
        distinct_id: 'd1',
        timestamp: '2026-07-01 00:00:00.000',
        product_id: 'pro_monthly',
        price: 9.99,
      },
    ]);
  });

  it('zero-state: empty CH rows and empty Postgres groups yield zeros/empty arrays, not NaN/undefined', async () => {
    const prisma = {
      revenueCatIntegration: { findUnique: jest.fn(async () => ({ id: 'int-1' })) },
      subscriptionState: { groupBy: jest.fn(async () => []) },
    } as any;
    const clickhouse = { query: jest.fn(async () => []) } as any;
    const projects = { assertMembership: jest.fn(async () => undefined) } as any;
    const svc = new RcMetricsService(prisma, clickhouse, projects);

    const s = await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10');

    expect(s).toEqual({
      mrr_cents: 0,
      active: 0,
      in_trial: 0,
      grace: 0,
      new_subscriptions: 0,
      churned: 0,
      trials_started: 0,
      trials_converted: 0,
      by_day: [],
      by_product: [],
      by_store: [],
      churn_reasons: [],
      recent_events: [],
    });
    expect(JSON.stringify(s)).not.toContain('NaN');
  });
});

describe('RcMetricsService.getAttribution', () => {
  it('404s without an integration and asserts membership with one', async () => {
    const a = build({ integration: null });
    await expect(a.svc.getAttribution('u1', PID)).rejects.toMatchObject({ status: 404 });
    const b = build();
    await b.svc.getAttribution('u1', PID);
    expect(b.projects.assertMembership).toHaveBeenCalledWith('u1', PID);
  });

  it('shapes empty CH results into empty arrays and zeroed funnel', async () => {
    const { svc } = build();
    const r = await svc.getAttribution('u1', PID);
    expect(r).toEqual({ drivers: [], screens: [], time_to_convert: [], trial_funnel: { trials: 0, converted: 0 } });
  });

  it('excludes $rc events from drivers and bounds the pre-purchase window', async () => {
    const { svc, clickhouse } = build();
    await svc.getAttribution('u1', PID);
    const driversSql = clickhouse.query.mock.calls.map((c: any) => c[0]).find((s: string) => s.includes('NOT LIKE'));
    expect(driversSql).toContain("NOT LIKE '$rc%'");
    expect(driversSql).toContain('INTERVAL 7 DAY');
  });

  it('canonicalizes identities in drivers/screens/first_seen so anon+identified events merge', async () => {
    const { svc, clickhouse } = build();
    await svc.getAttribution('u1', PID);
    const calls = clickhouse.query.mock.calls.map((c: any) => c[0]);
    const driversSql = calls.find((s: string) => s.includes('NOT LIKE'));
    const screensSql = calls.find((s: string) => s.includes('$screen_view'));
    const timeToConvertSql = calls.find((s: string) => s.includes('first_seen'));
    for (const sql of [driversSql, screensSql, timeToConvertSql]) {
      expect(sql).toContain('aliases');
      expect(sql).toContain('coalesce(aliases.canonical_id');
    }
    // settings arg (3rd) carries join_use_nulls=1 for every canonicalized query.
    const settingsArgs = clickhouse.query.mock.calls
      .filter((c: any) => [driversSql, screensSql, timeToConvertSql].includes(c[0]))
      .map((c: any) => c[2]);
    for (const settings of settingsArgs) {
      expect(settings).toEqual({ join_use_nulls: 1 });
    }
  });

  it('buckets time_to_convert by elapsed seconds, not truncated calendar days', async () => {
    const { svc, clickhouse } = build();
    await svc.getAttribution('u1', PID);
    const sql = clickhouse.query.mock.calls.map((c: any) => c[0]).find((s: string) => s.includes('first_seen'));
    expect(sql).toContain("dateDiff('second', s.fs, f.fp)");
    expect(sql).not.toContain("dateDiff('day'");
    expect(sql).toContain('secs < 86400');
  });

  it('funnel counts a renewal as conversion only when it comes after the trial start', async () => {
    const { svc, clickhouse } = build();
    await svc.getAttribution('u1', PID);
    const call = clickhouse.query.mock.calls.find((c: any) => c[0].includes('trial_starts'));
    expect(call[0]).toContain('r.first_renewal > t.trial_ts');
    expect(call[0]).not.toMatch(/distinct_id IN \(SELECT DISTINCT distinct_id/);
    // join_use_nulls=1 so an unmatched LEFT JOIN yields NULL (not epoch-zero) for first_renewal.
    expect(call[2]).toEqual({ join_use_nulls: 1 });
  });

  it('maps the funnel row to trials/converted counts', async () => {
    const { prisma, projects } = build();
    const clickhouse = {
      query: jest.fn(async (sql: string) =>
        sql.includes('trial_starts') ? [{ trials: 10, converted: 4 }] : [],
      ),
    } as any;
    const svc = new RcMetricsService(prisma, clickhouse, projects);
    const r = await svc.getAttribution('u1', PID);
    expect(r.trial_funnel).toEqual({ trials: 10, converted: 4 });
  });
});
