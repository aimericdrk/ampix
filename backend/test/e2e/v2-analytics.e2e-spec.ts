import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

/**
 * v2 analytics (contracts §19) end-to-end against a REAL ClickHouse + Postgres (testcontainers):
 * ingest a KNOWN dataset through the real /ingest API, then assert the EXACT click-heatmap cells,
 * screen-path nodes/links, engagement DAU/MAU/stickiness, and template-apply materialization.
 *
 * Datasets are isolated by distinct_id namespace AND by day so they never interfere:
 *  - heatmap `$tap`s      → DAY_C, users `hu*`
 *  - screen-path views    → DAY_C, users `su*`
 *  - engagement pings     → DAY_A / DAY_B, users `eu*`
 * The engagement query ranges over DAY_A..DAY_B only, so the DAY_C data is out of scope for it.
 *
 * Timestamps sit 2–4 days back to clear ingestion's 7-day floor (contracts §4).
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TODAY = Math.floor(Date.now() / DAY) * DAY;
const DAY_A = TODAY - 4 * DAY;
const DAY_B = TODAY - 3 * DAY;
const DAY_C = TODAY - 2 * DAY;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const DAY_A_STR = isoDate(DAY_A);
const DAY_B_STR = isoDate(DAY_B);
const DAY_C_STR = isoDate(DAY_C);

function uniqueEmail(): string {
  return `v2-${randomUUID()}@example.com`;
}

function makeEvent(opts: {
  event: string;
  distinctId: string;
  ts: number;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: opts.event,
    distinct_id: opts.distinctId,
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: opts.ts,
    properties: opts.properties ?? {},
    context: { os: 'ios', ...(opts.context ?? {}) },
  };
}

/** A `$tap` on `screen` at pixel (x,y) with device size (w,h). */
function tap(
  distinctId: string,
  screen: string,
  w: number,
  h: number,
  x: number,
  y: number,
): Record<string, unknown> {
  return makeEvent({
    event: '$tap',
    distinctId,
    ts: DAY_C + 1 * HOUR,
    properties: { $screen_name: screen, $pos_x: x, $pos_y: y },
    context: { screen_width: w, screen_height: h },
  });
}

/** A `$screen_view` of `screen` at hour-offset `h` on DAY_C. */
function view(distinctId: string, screen: string, h: number): Record<string, unknown> {
  return makeEvent({
    event: '$screen_view',
    distinctId,
    ts: DAY_C + h * HOUR,
    properties: { $screen_name: screen },
  });
}

/**
 * KNOWN dataset.
 *
 * HEATMAP (screen `checkout`, device 100×100, grid 2×2):
 *   3 taps in cell (0,0), 2 in (1,1), 1 in (1,0)  ⇒ total 6.
 *   Plus a tap on a different screen and one with 0-size device — both excluded.
 *
 * SCREEN-PATHS (anchor `home`, forward, 2 steps, unit=user):
 *   su1 home→browse→checkout, su2 home→browse→buy, su3 home→cart(→end)
 *   ⇒ 0:home=3; home→browse=2, home→cart=1, browse→checkout=1, browse→buy=1, cart→$end=1.
 *
 * ENGAGEMENT (interval=day, range DAY_A..DAY_B):
 *   eu1 active DAY_A+DAY_B, eu2 DAY_A only, eu3 DAY_B only.
 *   ⇒ DAU: A=2, B=2; new/returning: A={2,0}, B={1,1}; MAU=3; stickiness A=B=2/3.
 */
function seedEvents(): Record<string, unknown>[] {
  return [
    // --- heatmap ---
    tap('hu1', 'checkout', 100, 100, 10, 10),
    tap('hu2', 'checkout', 100, 100, 20, 20),
    tap('hu3', 'checkout', 100, 100, 30, 30),
    tap('hu4', 'checkout', 100, 100, 75, 75),
    tap('hu5', 'checkout', 100, 100, 80, 80),
    tap('hu6', 'checkout', 100, 100, 75, 25),
    tap('hu7', 'home', 100, 100, 50, 50), // different screen -> excluded
    tap('hu8', 'checkout', 0, 0, 50, 50), // 0-size device -> excluded
    // --- screen paths ---
    view('su1', 'home', 1),
    view('su1', 'browse', 2),
    view('su1', 'checkout', 3),
    view('su2', 'home', 1),
    view('su2', 'browse', 2),
    view('su2', 'buy', 3),
    view('su3', 'home', 1),
    view('su3', 'cart', 2),
    // --- engagement ---
    makeEvent({ event: 'eng_ping', distinctId: 'eu1', ts: DAY_A + 1 * HOUR }),
    makeEvent({ event: 'eng_ping', distinctId: 'eu1', ts: DAY_B + 1 * HOUR }),
    makeEvent({ event: 'eng_ping', distinctId: 'eu2', ts: DAY_A + 2 * HOUR }),
    makeEvent({ event: 'eng_ping', distinctId: 'eu3', ts: DAY_B + 2 * HOUR }),
  ];
}

describe('v2 analytics query engine (e2e, contracts §19)', () => {
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
      .send({ email: uniqueEmail(), password: 'password123', name: 'V2 Tester' })
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
  }, 180_000);

  afterAll(async () => {
    await stack.stop();
  });

  function auth(method: 'get' | 'post', path: string, token = accessToken) {
    return request(stack.app.getHttpServer())
      [method](`/api/v1/projects/${projectId}/${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('POST /query/click-heatmap', () => {
    it('buckets known taps into exact cell counts, skipping the other screen + 0-size rows', async () => {
      const res = await auth('post', 'query/click-heatmap')
        .send({
          screen_name: 'checkout',
          date_range: { from: DAY_C_STR, to: DAY_C_STR },
          grid: { cols: 2, rows: 2 },
        })
        .expect(200);

      expect(res.body.screen_name).toBe('checkout');
      expect(res.body.total).toBe(6);

      const cell = (cx: number, cy: number) =>
        res.body.cells.find((c: { cx: number; cy: number }) => c.cx === cx && c.cy === cy)?.count;
      expect(cell(0, 0)).toBe(3);
      expect(cell(1, 1)).toBe(2);
      expect(cell(1, 0)).toBe(1);
      // No other cells (empty ones omitted).
      expect(res.body.cells).toHaveLength(3);
    });

    it('401 unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/query/click-heatmap`)
        .send({ screen_name: 'checkout', date_range: { from: DAY_C_STR, to: DAY_C_STR }, grid: { cols: 2, rows: 2 } })
        .expect(401);
    });
  });

  describe('POST /query/screen-paths', () => {
    it('returns exact screen nodes/links incl. the $end drop-off (anchored)', async () => {
      const res = await auth('post', 'query/screen-paths')
        .send({
          anchor_screen: 'home',
          direction: 'forward',
          date_range: { from: DAY_C_STR, to: DAY_C_STR },
          steps: 2,
          max_nodes_per_step: 8,
          unit: 'user',
        })
        .expect(200);

      const node = (id: string) => res.body.nodes.find((n: { id: string }) => n.id === id)?.value;
      const link = (s: string, t: string) =>
        res.body.links.find((l: { source: string; target: string }) => l.source === s && l.target === t)?.value;

      expect(node('0:home')).toBe(3);
      expect(link('0:home', '1:browse')).toBe(2);
      expect(link('0:home', '1:cart')).toBe(1);
      expect(link('1:browse', '2:checkout')).toBe(1);
      expect(link('1:browse', '2:buy')).toBe(1);
      expect(link('1:cart', '2:$end')).toBe(1);
    });

    it('with no anchor_screen, paths start from each unit’s entry screen', async () => {
      const res = await auth('post', 'query/screen-paths')
        .send({
          direction: 'forward',
          date_range: { from: DAY_C_STR, to: DAY_C_STR },
          steps: 1,
          max_nodes_per_step: 8,
          unit: 'user',
        })
        .expect(200);

      const node = (id: string) => res.body.nodes.find((n: { id: string }) => n.id === id)?.value;
      // Every su enters on `home`.
      expect(node('0:home')).toBe(3);
    });
  });

  describe('GET /metrics/engagement', () => {
    it('returns exact DAU, new/returning and stickiness (DAU/MAU) by canonical uid', async () => {
      const res = await auth('get', 'metrics/engagement')
        .query({ from: DAY_A_STR, to: DAY_B_STR, interval: 'day' })
        .expect(200);

      expect(res.body.active).toEqual([
        { t: DAY_A_STR, metric: 'dau', value: 2 },
        { t: DAY_B_STR, metric: 'dau', value: 2 },
      ]);
      expect(res.body.new_vs_returning).toEqual([
        { t: DAY_A_STR, new: 2, returning: 0 },
        { t: DAY_B_STR, new: 1, returning: 1 },
      ]);
      // MAU over the range = {eu1, eu2, eu3} = 3; stickiness = active(2) / 3.
      expect(res.body.stickiness[0].value).toBeCloseTo(2 / 3, 4);
      expect(res.body.stickiness[1].value).toBeCloseTo(2 / 3, 4);
    });
  });

  describe('Templates', () => {
    it('GET /api/v1/templates lists the fixed 7-template catalog', async () => {
      const res = await request(stack.app.getHttpServer())
        .get('/api/v1/templates')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.templates).toHaveLength(7);
      const engagement = res.body.templates.find((t: { id: string }) => t.id === 'engagement');
      expect(engagement.kind_counts).toEqual({ insights: 2 });
    });

    it('apply materializes the expected reports + dashboard, and is idempotent', async () => {
      const applyRes = await auth('post', 'templates/engagement/apply').expect(200);
      const dashboardId = applyRes.body.dashboard_id;
      expect(dashboardId).toBeTruthy();

      const detail = await auth('get', `dashboards/${dashboardId}`).expect(200);
      expect(detail.body.name).toBe('Engagement');
      expect(detail.body.tiles).toHaveLength(2);
      expect(detail.body.tiles.every((t: { kind: string }) => t.kind === 'insights')).toBe(true);

      const reports = await auth('get', 'reports').expect(200);
      const names = reports.body.reports.map((r: { name: string }) => r.name);
      expect(names).toEqual(expect.arrayContaining(['Active Users', 'Sessions']));

      // Re-apply -> same dashboard, no duplicates.
      const again = await auth('post', 'templates/engagement/apply').expect(200);
      expect(again.body.dashboard_id).toBe(dashboardId);

      const dashboards = await auth('get', 'dashboards').expect(200);
      const engagementDashboards = dashboards.body.dashboards.filter(
        (d: { name: string }) => d.name === 'Engagement',
      );
      expect(engagementDashboards).toHaveLength(1);
    });

    it('403 for a non-member trying to apply', async () => {
      const outsider = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: uniqueEmail(), password: 'password123', name: 'Outsider' })
        .expect(200);

      await auth('post', 'templates/engagement/apply', outsider.body.access_token).expect(403);
    });
  });
});
