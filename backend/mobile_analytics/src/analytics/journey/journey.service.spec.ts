import type { ClickHouseService } from '../../clickhouse/clickhouse.service';
import type { ProjectsService } from '../../projects/core/projects.service';
import { JourneyService } from './journey.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';

/** The five queries the service fires, in the order `Promise.all` receives them. */
type Fixtures = {
  summary?: unknown[];
  days?: unknown[];
  path?: unknown[];
  frequency?: unknown[];
  screens?: unknown[];
  products?: unknown[];
};

function build({ fixtures = {} as Fixtures }: { fixtures?: Fixtures } = {}) {
  // Routed by a marker unique to each statement rather than by call order, so the assertions stay
  // valid if the Promise.all ever reorders.
  const clickhouse = {
    query: jest.fn(async (sql: string, _params: Record<string, unknown>): Promise<unknown[]> => {
      if (sql.includes('per_user AS')) return fixtures.summary ?? [];
      if (sql.includes('origins AS')) return fixtures.days ?? [];
      if (sql.includes('steps AS')) return fixtures.path ?? [];
      if (sql.includes("event = '$screen_view'")) return fixtures.screens ?? [];
      if (sql.includes('$product_id')) return fixtures.products ?? [];
      return fixtures.frequency ?? [];
    }),
  };
  const projects = { assertMembership: jest.fn(async () => undefined) };
  return {
    clickhouse,
    projects,
    svc: new JourneyService(
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

describe('JourneyService.getJourney', () => {
  // The whole point of living under analytics: no RevenueCat integration row is consulted, so a
  // project that has never configured the MyRevenueCat clone still gets a report.
  it('reports without a RevenueCat integration, reading only the event stream', async () => {
    const { svc, clickhouse } = build({ fixtures: { summary: SUMMARY_ROWS } });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    expect(report.cohort.users).toBe(100);
    expect(clickhouse.query).toHaveBeenCalled();
  });

  it('asserts membership before touching ClickHouse', async () => {
    const { clickhouse } = build();
    const projects = {
      assertMembership: jest.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { problem: { status: 403 } })),
      ),
    };
    const svc = new JourneyService(
      clickhouse as unknown as ClickHouseService,
      projects as unknown as ProjectsService,
    );
    await expect(svc.getJourney('u1', PID, 'subscribe')).rejects.toMatchObject({
      problem: { status: 403 },
    });
    expect(clickhouse.query).not.toHaveBeenCalled();
  });

  it('binds every request value as a query param and interpolates none of them', async () => {
    const { svc, clickhouse } = build();
    await svc.getJourney('u1', PID, 'subscribe', '2026-07-01', '2026-07-10', 14, 12);
    expect(clickhouse.query.mock.calls.length).toBe(6);
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

  it('measures renewals against subscribers who did not renew', async () => {
    const { svc, clickhouse } = build();
    const report = await svc.getJourney('u1', PID, 'renew');
    expect(report.definition.outcome).toBe('renew');
    expect(report.definition.outcome_events).toEqual(['$rc_renewal']);
    // Renewal is only reachable by someone who already paid, so the control is other subscribers.
    expect(report.definition.control_criteria).toContain('$rc_initial_purchase');
    expect(report.definition.control_criteria).toContain('never renewed');
    // Elapsed time runs purchase -> renewal, not first-seen -> renewal.
    const days = report.summary.find((m) => m.metric === 'days_to_outcome')!;
    expect(days.definition).toContain('$rc_initial_purchase');
    expect(days.definition).toContain('$rc_renewal');
    for (const [sql] of clickhouse.query.mock.calls) {
      expect(sql).toContain('$rc_renewal');
    }
  });

  it('reports which subscription the outcome was, off the webhook product id', async () => {
    const { svc } = build({
      fixtures: {
        summary: SUMMARY_ROWS,
        products: [
          { product_id: 'pro_annual', period_type: 'NORMAL', users: 70 },
          { product_id: 'pro_monthly', period_type: 'TRIAL', users: 30 },
        ],
      },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    expect(report.products).toEqual([
      { product_id: 'pro_annual', period_type: 'NORMAL', users: 70, share: 0.7 },
      { product_id: 'pro_monthly', period_type: 'TRIAL', users: 30, share: 0.3 },
    ]);
  });

  it('reports a missing product id as null, not as an empty string', async () => {
    const { svc } = build({
      fixtures: { summary: SUMMARY_ROWS, products: [{ product_id: '', period_type: '', users: 5 }] },
    });
    const report = await svc.getJourney('u1', PID, 'subscribe');
    expect(report.products[0]).toMatchObject({ product_id: null, period_type: null });
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
