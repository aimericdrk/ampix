import type { ClickHouseService } from '../../clickhouse/clickhouse.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProjectsService } from '../../projects/core/projects.service';
import { RcJourneyService } from './rc-journey.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';

/** The five queries the service fires, in the order `Promise.all` receives them. */
type Fixtures = {
  summary?: unknown[];
  days?: unknown[];
  path?: unknown[];
  frequency?: unknown[];
  screens?: unknown[];
};

function build({
  integration = { id: 'int-1' } as unknown,
  fixtures = {} as Fixtures,
}: { integration?: unknown; fixtures?: Fixtures } = {}) {
  const prisma = {
    revenueCatIntegration: { findUnique: jest.fn(async () => integration) },
  } as unknown as PrismaService;
  // Routed by a marker unique to each statement rather than by call order, so the assertions stay
  // valid if the Promise.all ever reorders.
  const clickhouse = {
    query: jest.fn(async (sql: string, _params: Record<string, unknown>): Promise<unknown[]> => {
      if (sql.includes('per_user AS')) return fixtures.summary ?? [];
      if (sql.includes('origins AS')) return fixtures.days ?? [];
      if (sql.includes('steps AS')) return fixtures.path ?? [];
      if (sql.includes("event = '$screen_view'")) return fixtures.screens ?? [];
      return fixtures.frequency ?? [];
    }),
  };
  const projects = { assertMembership: jest.fn(async () => undefined) };
  return {
    prisma,
    clickhouse,
    projects,
    svc: new RcJourneyService(
      prisma,
      clickhouse as unknown as ClickHouseService,
      projects as unknown as ProjectsService,
    ),
  };
}

const SUMMARY_ROWS = [
  {
    grp: 'cohort',
    users: 100,
    steps_p25: 10,
    steps_p50: 20,
    steps_p75: 30,
    sessions_p25: 2,
    sessions_p50: 4,
    sessions_p75: 6,
    names_p25: 3,
    names_p50: 5,
    names_p75: 8,
  },
  {
    grp: 'control',
    users: 400,
    steps_p25: 4,
    steps_p50: 8,
    steps_p75: 12,
    sessions_p25: 1,
    sessions_p50: 2,
    sessions_p75: 3,
    names_p25: 2,
    names_p50: 4,
    names_p75: 5,
  },
];

describe('RcJourneyService.getJourney', () => {
  it('404s when the project has no RevenueCat integration', async () => {
    const { svc } = build({ integration: null });
    await expect(svc.getJourney('u1', PID, 'subscribe')).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('asserts membership before touching Postgres or ClickHouse', async () => {
    const { prisma, clickhouse } = build();
    const projects = {
      assertMembership: jest.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      ),
    };
    const svc = new RcJourneyService(
      prisma,
      clickhouse as unknown as ClickHouseService,
      projects as unknown as ProjectsService,
    );
    await expect(svc.getJourney('u1', PID, 'subscribe')).rejects.toMatchObject({
      problem: { status: 403 },
    });
    expect(prisma.revenueCatIntegration.findUnique).not.toHaveBeenCalled();
    expect(clickhouse.query).not.toHaveBeenCalled();
  });

  it('binds every request value as a query param and interpolates none of them', async () => {
    const { svc, clickhouse } = build();
    await svc.getJourney('u1', PID, 'subscribe', '2026-07-01', '2026-07-10', 14, 12);
    expect(clickhouse.query.mock.calls.length).toBe(5);
    for (const [sql, params] of clickhouse.query.mock.calls) {
      expect(sql).toContain('{projectId:UUID}');
      expect(sql).not.toContain(PID);
      expect(sql).not.toContain('2026-07-01');
      expect(params.projectId).toBe(PID);
      expect(params.windowDays).toBe(14);
      expect(params.pathSteps).toBe(12);
    }
  });

  it('clamps the window and step count into their supported ranges', async () => {
    const { svc, clickhouse } = build();
    await svc.getJourney('u1', PID, 'subscribe', undefined, undefined, 999, 999);
    const [, params] = clickhouse.query.mock.calls[0];
    expect(params.windowDays).toBe(30);
    expect(params.pathSteps).toBe(20);

    clickhouse.query.mockClear();
    await svc.getJourney('u1', PID, 'subscribe', undefined, undefined, 0, 1);
    const [, floored] = clickhouse.query.mock.calls[0];
    expect(floored.windowDays).toBe(1);
    expect(floored.pathSteps).toBe(3);
  });

  it('reports the refund criteria as CUSTOMER_SUPPORT and excludes a voluntary unsubscribe', async () => {
    const { svc, clickhouse } = build();
    const report = await svc.getJourney('u1', PID, 'refund');
    expect(report.definition.outcome).toBe('refund');
    expect(report.definition.outcome_events).toEqual(['$rc_cancellation', '$rc_expiration']);
    expect(report.definition.outcome_criteria).toContain('CUSTOMER_SUPPORT');
    expect(report.definition.outcome_criteria).toContain('UNSUBSCRIBE');
    // The refund control is other SUBSCRIBERS, not everyone who never paid.
    expect(report.definition.control_criteria).toContain('$rc_initial_purchase');
    for (const [sql] of clickhouse.query.mock.calls) {
      expect(sql).toContain('CUSTOMER_SUPPORT');
    }
  });

  it('summarises both groups and derives lift from the medians', async () => {
    const { svc } = build({ fixtures: { summary: SUMMARY_ROWS } });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    expect(report.cohort.users).toBe(100);
    expect(report.control.users).toBe(400);

    const steps = report.summary.find((m) => m.metric === 'steps_before')!;
    expect(steps.cohort).toEqual({ p25: 10, median: 20, p75: 30 });
    expect(steps.control).toEqual({ p25: 4, median: 8, p75: 12 });
    expect(steps.lift).toBe(2.5);
    expect(steps.unit).toBe('events');
  });

  it('reports days_to_outcome with no control side rather than a misleading zero', async () => {
    const { svc } = build({
      fixtures: { summary: SUMMARY_ROWS, days: [{ p25: 1, p50: 4.2, p75: 9, users: 100 }] },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    const days = report.summary.find((m) => m.metric === 'days_to_outcome')!;
    expect(days.cohort).toEqual({ p25: 1, median: 4.2, p75: 9 });
    expect(days.control).toBeNull();
    expect(days.lift).toBeNull();
    expect(days.unit).toBe('days');
  });

  it('leaves days_to_outcome absent when no cohort user has a measurable origin', async () => {
    const { svc } = build({
      fixtures: { summary: SUMMARY_ROWS, days: [{ p25: 0, p50: 0, p75: 0, users: 0 }] },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    expect(report.summary.find((m) => m.metric === 'days_to_outcome')!.cohort).toBeNull();
  });

  it('keeps the modal event per position and orders the path oldest-first', async () => {
    const { svc } = build({
      fixtures: {
        summary: SUMMARY_ROWS,
        path: [
          // Rows arrive position-ascending, then user-count-descending.
          { steps_before_outcome: 1, event: 'paywall_viewed', screen_name: '', users: 74, median_seconds_to_outcome: 21 },
          { steps_before_outcome: 1, event: 'app_open', screen_name: '', users: 8, median_seconds_to_outcome: 90 },
          { steps_before_outcome: 2, event: '$screen_view', screen_name: '/pay', users: 70, median_seconds_to_outcome: 84 },
        ],
      },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    expect(report.path.map((s) => s.steps_before_outcome)).toEqual([2, 1]);
    expect(report.path[1]).toEqual({
      steps_before_outcome: 1,
      event: 'paywall_viewed',
      screen_name: null,
      users: 74,
      share: 0.74,
      median_seconds_to_outcome: 21,
    });
    // A screen view keeps its screen: /pay and /home are different steps, not one blurred step.
    expect(report.path[0].screen_name).toBe('/pay');
  });

  it('averages frequency over EVERY user in a group, including those who never did it', async () => {
    const { svc } = build({
      fixtures: {
        summary: SUMMARY_ROWS,
        frequency: [
          { grp: 'cohort', name: 'paywall_viewed', occurrences: 240, users: 90 },
          { grp: 'control', name: 'paywall_viewed', occurrences: 120, users: 60 },
        ],
      },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    const row = report.frequency.find((r) => r.name === 'paywall_viewed')!;
    // 240 occurrences over the cohort's 100 users, not over the 90 who did it at least once.
    expect(row.cohort_per_user).toBe(2.4);
    expect(row.control_per_user).toBe(0.3);
    expect(row.cohort_user_share).toBe(0.9);
    expect(row.control_user_share).toBe(0.15);
    expect(row.lift).toBe(8);
  });

  it('reports an undefined lift as null rather than Infinity', async () => {
    const { svc } = build({
      fixtures: {
        summary: SUMMARY_ROWS,
        frequency: [{ grp: 'cohort', name: 'only_converters_do_this', occurrences: 50, users: 40 }],
      },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    const row = report.frequency.find((r) => r.name === 'only_converters_do_this')!;
    expect(row.control_per_user).toBe(0);
    expect(row.lift).toBeNull();
  });

  it('ships the definitions an AI needs to read the numbers without this file', async () => {
    const { svc } = build({ fixtures: { summary: SUMMARY_ROWS } });
    const report = await svc.getJourney('u1', PID, 'subscribe', '2026-07-01', '2026-07-10', 14, 6);
    expect(report.definition).toMatchObject({
      outcome: 'subscribe',
      window_days: 14,
      path_steps: 6,
      excluded_event_prefix: '$rc',
      date_range: { from: '2026-07-01', to: '2026-07-10' },
    });
    expect(report.definition.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const metric of report.summary) {
      expect(metric.unit).toBeTruthy();
      expect(metric.definition.length).toBeGreaterThan(0);
    }
  });
});
