import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

/**
 * Phase-5 (contracts §16) end-to-end against a REAL ClickHouse + Postgres (testcontainers): ingest a
 * KNOWN dataset through the real /ingest API, then assert the EXACT cohort/report/dashboard numbers.
 *
 * KNOWN dataset (event names namespaced `p_` so they never interfere):
 *   pu1: p_open, p_buy                 → is a "buyer", did p_open
 *   pu2: p_open, p_buy, p_buy (x2)     → is a "buyer" (2 buys), did p_open
 *   pu3: p_open                        → NOT a buyer
 *
 *   Cohort "buyers" = did p_buy >= 1 in last 30d  → EXACTLY {pu1, pu2} (count 2).
 *   Insights p_open unique_users        → 3 (pu1,pu2,pu3);  cohort-filtered → 2 (pu1,pu2).
 *   Insights p_buy total (DISTINCT insert_id) → 3 (pu1:1 + pu2:2).
 *
 * Timestamps sit 2 days back to clear ingestion's 7-day floor (contracts §4) while the 30-day cohort
 * window still captures them.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TODAY = Math.floor(Date.now() / DAY) * DAY;
const DAY_A = TODAY - 4 * DAY;
const DAY_C = TODAY - 2 * DAY;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const RANGE = { from: isoDate(DAY_A), to: isoDate(TODAY) };

function uniqueEmail(): string {
  return `p5-${randomUUID()}@example.com`;
}

function makeEvent(event: string, distinctId: string, ts: number): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event,
    distinct_id: distinctId,
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: ts,
    properties: {},
    context: { os: 'ios' },
  };
}

function seedEvents(): Record<string, unknown>[] {
  return [
    makeEvent('p_open', 'pu1', DAY_C + 1 * HOUR),
    makeEvent('p_buy', 'pu1', DAY_C + 2 * HOUR),
    makeEvent('p_open', 'pu2', DAY_C + 1 * HOUR),
    makeEvent('p_buy', 'pu2', DAY_C + 2 * HOUR),
    makeEvent('p_buy', 'pu2', DAY_C + 3 * HOUR),
    makeEvent('p_open', 'pu3', DAY_C + 1 * HOUR),
  ];
}

const BUYERS_DEFINITION = {
  match: 'all',
  conditions: [{ type: 'behavior', event: 'p_buy', op: 'gte', count: 1, within_days: 30 }],
};
const OPENS_INSIGHTS = {
  events: [{ name: 'p_open', aggregation: 'unique_users' }],
  date_range: RANGE,
  interval: 'day',
};
const BUYS_INSIGHTS = {
  events: [{ name: 'p_buy', aggregation: 'total' }],
  date_range: RANGE,
  interval: 'day',
};

/** Sum of a single insights series' bucket values (all our events land on one day). */
function seriesTotal(body: { series: { data: { value: number }[] }[] }): number {
  return body.series[0].data.reduce((sum, point) => sum + point.value, 0);
}

describe('Cohorts, saved reports & dashboards (e2e, contracts §16)', () => {
  let stack: TestStack;
  let accessToken: string;
  let projectId: string;
  let cohortId: string;
  let reportId: string;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
    });

    const signupRes = await request(stack.app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail(), password: 'password123', name: 'Phase5 Tester' })
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

  function auth(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    return request(stack.app.getHttpServer())
      [method](`/api/v1/projects/${projectId}/${path}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  describe('Cohorts', () => {
    it('creates a cohort and previews the EXACT expected users', async () => {
      const createRes = await auth('post', 'cohorts')
        .send({ name: 'Buyers', definition: BUYERS_DEFINITION })
        .expect(201);
      cohortId = createRes.body.id;
      // The stored definition is the zod-normalized form (condition `filters` default to []).
      expect(createRes.body.definition).toEqual({
        match: 'all',
        conditions: [
          { type: 'behavior', event: 'p_buy', op: 'gte', count: 1, within_days: 30, filters: [] },
        ],
      });

      const preview = await auth('get', `cohorts/${cohortId}/preview`).expect(200);
      expect(preview.body.count).toBe(2);
      expect([...preview.body.sample].sort()).toEqual(['pu1', 'pu2']);
    });

    it('lists cohorts (viewer+) and 400s an invalid definition on write', async () => {
      const list = await auth('get', 'cohorts').expect(200);
      expect(list.body.cohorts.some((c: { id: string }) => c.id === cohortId)).toBe(true);

      await auth('post', 'cohorts')
        .send({ name: 'Bad', definition: { match: 'nonsense', conditions: [] } })
        .expect(400);
    });
  });

  describe('cohort_id filter on insights', () => {
    it('a plain insight counts all users; the cohort-filtered insight narrows to cohort members', async () => {
      const plain = await auth('post', 'query/insights').send(OPENS_INSIGHTS).expect(200);
      expect(seriesTotal(plain.body)).toBe(3);

      const filtered = await auth('post', 'query/insights')
        .send({ ...OPENS_INSIGHTS, cohort_id: cohortId })
        .expect(200);
      expect(seriesTotal(filtered.body)).toBe(2);
    });
  });

  describe('Saved reports', () => {
    it('creates a report, runs it, and applies a cohort_id override on run', async () => {
      const createRes = await auth('post', 'reports')
        .send({ name: 'Opens', kind: 'insights', definition: OPENS_INSIGHTS })
        .expect(201);
      reportId = createRes.body.id;

      const run = await auth('post', `reports/${reportId}/run`).send({}).expect(200);
      expect(seriesTotal(run.body)).toBe(3);

      const runFiltered = await auth('post', `reports/${reportId}/run`)
        .send({ cohort_id: cohortId })
        .expect(200);
      expect(seriesTotal(runFiltered.body)).toBe(2);
    });

    it('400s a report whose definition does not match its kind', async () => {
      await auth('post', 'reports')
        .send({ name: 'Wrong', kind: 'funnel', definition: OPENS_INSIGHTS })
        .expect(400);
    });
  });

  describe('Dashboards', () => {
    let dashboardId: string;
    let reportTileId: string;
    let inlineTileId: string;

    it('creates a dashboard with a report-backed tile and an inline tile', async () => {
      const dash = await auth('post', 'dashboards').send({ name: 'Board' }).expect(201);
      dashboardId = dash.body.id;

      const t1 = await auth('post', `dashboards/${dashboardId}/tiles`)
        .send({ title: 'Opens', kind: 'insights', saved_report_id: reportId, x: 0, y: 0, w: 6, h: 4 })
        .expect(201);
      reportTileId = t1.body.id;

      const t2 = await auth('post', `dashboards/${dashboardId}/tiles`)
        .send({ title: 'Buys', kind: 'insights', inline_definition: BUYS_INSIGHTS, x: 6, y: 0, w: 6, h: 4 })
        .expect(201);
      inlineTileId = t2.body.id;

      const detail = await auth('get', `dashboards/${dashboardId}`).expect(200);
      expect(detail.body.tiles).toHaveLength(2);
    });

    it('rejects tiles that break the exactly-one-of rule or the 12-column grid', async () => {
      await auth('post', `dashboards/${dashboardId}/tiles`)
        .send({ title: 'Both', kind: 'insights', saved_report_id: reportId, inline_definition: BUYS_INSIGHTS, x: 0, y: 0, w: 6, h: 4 })
        .expect(400);

      await auth('post', `dashboards/${dashboardId}/tiles`)
        .send({ title: 'Overflow', kind: 'insights', inline_definition: BUYS_INSIGHTS, x: 8, y: 0, w: 6, h: 4 })
        .expect(400);
    });

    it('GET /data batch-runs every tile and returns each tile’s EXACT result', async () => {
      const data = await auth('get', `dashboards/${dashboardId}/data`).expect(200);
      expect(data.body.tiles).toHaveLength(2);

      const reportTile = data.body.tiles.find((t: { id: string }) => t.id === reportTileId);
      const inlineTile = data.body.tiles.find((t: { id: string }) => t.id === inlineTileId);

      expect(seriesTotal(reportTile.result)).toBe(3); // p_open unique_users
      expect(seriesTotal(inlineTile.result)).toBe(3); // p_buy total (pu1:1 + pu2:2)
    });

    it('batch-saves the grid layout and deletes a tile', async () => {
      await auth('patch', `dashboards/${dashboardId}/layout`)
        .send({
          tiles: [
            { id: reportTileId, x: 0, y: 0, w: 12, h: 4, position: 0 },
            { id: inlineTileId, x: 0, y: 4, w: 12, h: 4, position: 1 },
          ],
        })
        .expect(200);

      const afterLayout = await auth('get', `dashboards/${dashboardId}`).expect(200);
      expect(afterLayout.body.tiles.find((t: { id: string }) => t.id === reportTileId).w).toBe(12);

      await auth('delete', `dashboards/${dashboardId}/tiles/${inlineTileId}`).expect(204);
      const afterDelete = await auth('get', `dashboards/${dashboardId}`).expect(200);
      expect(afterDelete.body.tiles).toHaveLength(1);
    });
  });
});
