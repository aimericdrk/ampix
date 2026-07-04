import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

/**
 * Phase-4 advanced analysis (contracts §15) end-to-end against a REAL ClickHouse (testcontainers):
 * ingest a KNOWN dataset through the real /ingest API, then assert the EXACT funnel / retention / flow
 * numbers the query engine returns. Event names are namespaced per analysis (`f_`/`r_`/`x_`) and each
 * query filters by its own events, so the three datasets never interfere.
 *
 * Timestamps are anchored to the ACTUAL current time: ingestion clamps client timestamps to
 * [now-7d, now+5min] (contracts §4), so every event sits 2–4 days back to clear the 7-day floor while
 * leaving room for retention "return" periods to be fully elapsed before the query's `to` bound.
 */

const DAY = 86_400_000;
const TODAY = Math.floor(Date.now() / DAY) * DAY;
const DAY_A = TODAY - 4 * DAY; // earliest cohort birth
const DAY_B = TODAY - 3 * DAY;
const DAY_C = TODAY - 2 * DAY; // funnel + flow day

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const RANGE = { from: isoDate(DAY_A), to: isoDate(TODAY) };

function uniqueEmail(): string {
  return `adv-${randomUUID()}@example.com`;
}

function makeEvent(opts: {
  event: string;
  distinctId: string;
  ts: number;
}): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: opts.event,
    distinct_id: opts.distinctId,
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: opts.ts,
    properties: {},
    context: { os: 'ios' },
  };
}

/**
 * KNOWN dataset:
 *
 * FUNNEL (f_open → f_signup → f_checkout, window 7d):
 *   fu1 all three (→ level 3), fu2 open+signup (→ 2), fu3 open only (→ 1)
 *   ⇒ step counts [3, 2, 1]; overall 1/3.
 *
 * RETENTION (born f... no — born r_signup, return r_open, interval day, periods 1):
 *   ru1 signup@A + open@B (born A, returns period 1)
 *   ru2 signup@A            (born A, no return)
 *   ru3 signup@B            (born B)
 *   ⇒ cohort A size 2: p0={2,1.0}, p1={1,0.5};  cohort B size 1: p0={1,1.0}
 *
 * FLOWS (anchor x_open, forward, 2 steps, unit=user):
 *   xu1 open→browse→cart, xu2 open→browse→buy, xu3 open→cart(→end)
 *   ⇒ node 0:x_open=3; links open→browse=2, open→cart=1, cart→$end=1
 */
function seedEvents(): Record<string, unknown>[] {
  return [
    // --- funnel ---
    makeEvent({ event: 'f_open', distinctId: 'fu1', ts: DAY_C + 1 * 3_600_000 }),
    makeEvent({ event: 'f_signup', distinctId: 'fu1', ts: DAY_C + 2 * 3_600_000 }),
    makeEvent({ event: 'f_checkout', distinctId: 'fu1', ts: DAY_C + 3 * 3_600_000 }),
    makeEvent({ event: 'f_open', distinctId: 'fu2', ts: DAY_C + 1 * 3_600_000 }),
    makeEvent({ event: 'f_signup', distinctId: 'fu2', ts: DAY_C + 2 * 3_600_000 }),
    makeEvent({ event: 'f_open', distinctId: 'fu3', ts: DAY_C + 1 * 3_600_000 }),
    // --- retention ---
    makeEvent({ event: 'r_signup', distinctId: 'ru1', ts: DAY_A + 1 * 3_600_000 }),
    makeEvent({ event: 'r_open', distinctId: 'ru1', ts: DAY_B + 1 * 3_600_000 }),
    makeEvent({ event: 'r_signup', distinctId: 'ru2', ts: DAY_A + 1 * 3_600_000 }),
    makeEvent({ event: 'r_signup', distinctId: 'ru3', ts: DAY_B + 1 * 3_600_000 }),
    // --- flows ---
    makeEvent({ event: 'x_open', distinctId: 'xu1', ts: DAY_C + 1 * 3_600_000 }),
    makeEvent({ event: 'x_browse', distinctId: 'xu1', ts: DAY_C + 2 * 3_600_000 }),
    makeEvent({ event: 'x_cart', distinctId: 'xu1', ts: DAY_C + 3 * 3_600_000 }),
    makeEvent({ event: 'x_open', distinctId: 'xu2', ts: DAY_C + 1 * 3_600_000 }),
    makeEvent({ event: 'x_browse', distinctId: 'xu2', ts: DAY_C + 2 * 3_600_000 }),
    makeEvent({ event: 'x_buy', distinctId: 'xu2', ts: DAY_C + 3 * 3_600_000 }),
    makeEvent({ event: 'x_open', distinctId: 'xu3', ts: DAY_C + 1 * 3_600_000 }),
    makeEvent({ event: 'x_cart', distinctId: 'xu3', ts: DAY_C + 2 * 3_600_000 }),
  ];
}

describe('Advanced analysis query engine (e2e, contracts §15)', () => {
  let stack: TestStack;
  let accessToken: string;
  let projectId: string;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
    });

    const signupRes = await request(stack.app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail(), password: 'password123', name: 'Adv Tester' })
      .expect(200);
    accessToken = signupRes.body.access_token;

    const projectsRes = await request(stack.app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    projectId = projectsRes.body.projects[0].id;
    const ingestToken = projectsRes.body.projects[0].ingest_token;

    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({ events: seedEvents() })
      .expect(202);
  }, 120_000);

  afterAll(async () => {
    await stack.stop();
  });

  function post(path: string, body: object) {
    return request(stack.app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  describe('POST /query/funnels', () => {
    it('returns the exact per-step counts and conversion rates for a known drop-off', async () => {
      const res = await post('query/funnels', {
        steps: [{ event: 'f_open' }, { event: 'f_signup' }, { event: 'f_checkout' }],
        date_range: RANGE,
        window_days: 7,
      }).expect(200);

      const counts = res.body.steps.map((s: { count: number }) => s.count);
      expect(counts).toEqual([3, 2, 1]);
      expect(res.body.steps[0]).toMatchObject({
        event: 'f_open',
        conversion_from_prev: 1,
        conversion_from_top: 1,
      });
      expect(res.body.steps[1].conversion_from_prev).toBeCloseTo(2 / 3, 3);
      expect(res.body.steps[1].conversion_from_top).toBeCloseTo(2 / 3, 3);
      expect(res.body.steps[2].conversion_from_prev).toBeCloseTo(1 / 2, 3);
      expect(res.body.steps[2].conversion_from_top).toBeCloseTo(1 / 3, 3);
      expect(res.body.overall_conversion).toBeCloseTo(1 / 3, 3);
    });

    it('a 400 is returned for fewer than 2 steps', async () => {
      await post('query/funnels', {
        steps: [{ event: 'f_open' }],
        date_range: RANGE,
        window_days: 7,
      }).expect(400);
    });
  });

  describe('POST /query/retention', () => {
    it('returns the exact cohort grid (born-bucket, return counts, rates)', async () => {
      const res = await post('query/retention', {
        born_event: { name: 'r_signup' },
        return_event: { name: 'r_open' },
        date_range: RANGE,
        interval: 'day',
        periods: 1,
      }).expect(200);

      // Two cohorts (born DAY_A with 2 users, born DAY_B with 1). Match by their unique sizes so the
      // assertion is independent of cohort ordering.
      expect(res.body.cohorts).toHaveLength(2);
      const cohortA = res.body.cohorts.find((c: { size: number }) => c.size === 2);
      const cohortB = res.body.cohorts.find((c: { size: number }) => c.size === 1);

      expect(cohortA.periods[0]).toEqual({ period: 0, count: 2, rate: 1 });
      expect(cohortA.periods[1]).toEqual({ period: 1, count: 1, rate: 0.5 });

      expect(cohortB.periods[0]).toEqual({ period: 0, count: 1, rate: 1 });

      // Size-weighted period-0 average is 1.0 by definition (every born user counts in period 0).
      const avg0 = res.body.averages.find((a: { period: number }) => a.period === 0);
      expect(avg0.rate).toBe(1);
    });
  });

  describe('POST /query/flows', () => {
    it('returns the exact Sankey nodes/links incl. the $end drop-off', async () => {
      const res = await post('query/flows', {
        anchor: { event: 'x_open' },
        direction: 'forward',
        date_range: RANGE,
        steps: 2,
        max_nodes_per_step: 8,
        unit: 'user',
      }).expect(200);

      const node = (id: string) =>
        res.body.nodes.find((n: { id: string }) => n.id === id);
      const link = (source: string, target: string) =>
        res.body.links.find(
          (l: { source: string; target: string }) => l.source === source && l.target === target,
        );

      // Anchor: all three users did x_open.
      expect(node('0:x_open')?.value).toBe(3);
      // Step 1 split: two users → browse, one → cart.
      expect(link('0:x_open', '1:x_browse')?.value).toBe(2);
      expect(link('0:x_open', '1:x_cart')?.value).toBe(1);
      // Drop-off: xu3 has no event after x_cart → flows into the synthetic $end node.
      expect(link('1:x_cart', '2:$end')?.value).toBe(1);
    });

    it('a 400 is returned for steps out of range', async () => {
      await post('query/flows', {
        anchor: { event: 'x_open' },
        date_range: RANGE,
        steps: 9,
        max_nodes_per_step: 8,
        unit: 'user',
      }).expect(400);
    });
  });
});
