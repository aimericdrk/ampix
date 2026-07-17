import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

async function signup(stack: TestStack, email: string) {
  return request(stack.app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', name: 'Analytics Tester' })
    .expect(200);
}

// Ingestion clamps client timestamps to [now-7d, now+5min] (contracts §4), so the dataset must be
// anchored to the ACTUAL current time rather than a hardcoded calendar date — otherwise every
// event would silently get clamped forward to `now-7d` and the "exact counts" assertions below
// would break. 2-3 days ago comfortably avoids both the 7-day floor and any midnight-rollover
// flakiness while the suite runs.
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const TODAY_UTC_MIDNIGHT = Math.floor(Date.now() / 86_400_000) * 86_400_000;
const DAY1 = TODAY_UTC_MIDNIGHT - 3 * 86_400_000;
const DAY2 = TODAY_UTC_MIDNIGHT - 2 * 86_400_000;
const DAY1_STR = isoDate(DAY1);
const DAY2_STR = isoDate(DAY2);

function makeEvent(opts: {
  event: string;
  distinctId: string;
  os: string;
  ts: number;
  properties?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: opts.event,
    distinct_id: opts.distinctId,
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: opts.ts,
    properties: opts.properties ?? {},
    context: { os: opts.os },
  };
}

/**
 * KNOWN dataset (contracts §14 e2e requirement) spanning 2 UTC days:
 *  - checkout_completed: day1 = {u1/ios, u1/ios, u2/android} -> total=3, unique_users=2, ios=2, android=1
 *                        day2 = {u1/ios, u2/android, u2/android} -> total=3, unique_users=2, ios=1, android=2
 *    (u1 repeats on day1, u2 repeats on day2 -> total != unique_users on both days).
 *    Every checkout_completed carries a custom `plan` property (pro for ios, free for android).
 *  - product_viewed: day1 = {u3/ios, u3/android}, day2 = {u3/ios, u3/android} -> total=2 per day.
 */
function seedEvents(): Record<string, unknown>[] {
  return [
    makeEvent({
      event: 'checkout_completed',
      distinctId: 'u1',
      os: 'ios',
      ts: DAY1 + 9 * 3_600_000,
      properties: { plan: 'pro' },
    }),
    makeEvent({
      event: 'checkout_completed',
      distinctId: 'u1',
      os: 'ios',
      ts: DAY1 + 10 * 3_600_000,
      properties: { plan: 'pro' },
    }),
    makeEvent({
      event: 'checkout_completed',
      distinctId: 'u2',
      os: 'android',
      ts: DAY1 + 11 * 3_600_000,
      properties: { plan: 'free' },
    }),
    makeEvent({
      event: 'checkout_completed',
      distinctId: 'u1',
      os: 'ios',
      ts: DAY2 + 9 * 3_600_000,
      properties: { plan: 'pro' },
    }),
    makeEvent({
      event: 'checkout_completed',
      distinctId: 'u2',
      os: 'android',
      ts: DAY2 + 10 * 3_600_000,
      properties: { plan: 'free' },
    }),
    makeEvent({
      event: 'checkout_completed',
      distinctId: 'u2',
      os: 'android',
      ts: DAY2 + 11 * 3_600_000,
      properties: { plan: 'free' },
    }),
    makeEvent({ event: 'product_viewed', distinctId: 'u3', os: 'ios', ts: DAY1 + 9 * 3_600_000 }),
    makeEvent({
      event: 'product_viewed',
      distinctId: 'u3',
      os: 'android',
      ts: DAY1 + 10 * 3_600_000,
    }),
    makeEvent({ event: 'product_viewed', distinctId: 'u3', os: 'ios', ts: DAY2 + 9 * 3_600_000 }),
    makeEvent({
      event: 'product_viewed',
      distinctId: 'u3',
      os: 'android',
      ts: DAY2 + 10 * 3_600_000,
    }),
  ];
}

const DATE_RANGE = { from: DAY1_STR, to: DAY2_STR };

describe('Core analytics query engine (e2e, contracts §14)', () => {
  let stack: TestStack;
  let accessToken: string;
  let projectId: string;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
    });

    const signupRes = await signup(stack, uniqueEmail());
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

  function postInsights(body: object, token = accessToken) {
    return request(stack.app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/query/insights`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  describe('POST /query/insights', () => {
    it('total aggregation returns the exact per-day counts, right buckets', async () => {
      const res = await postInsights({
        events: [{ name: 'checkout_completed', aggregation: 'total' }],
        date_range: DATE_RANGE,
        interval: 'day',
      }).expect(200);

      expect(res.body).toEqual({
        series: [
          {
            name: 'checkout_completed',
            breakdown_value: null,
            data: [
              { t: DAY1_STR, value: 3 },
              { t: DAY2_STR, value: 3 },
            ],
          },
        ],
      });
    });

    it('unique_users differs from total exactly where a distinct_id repeats within a day', async () => {
      const res = await postInsights({
        events: [{ name: 'checkout_completed', aggregation: 'unique_users' }],
        date_range: DATE_RANGE,
        interval: 'day',
      }).expect(200);

      expect(res.body.series[0].data).toEqual([
        { t: DAY1_STR, value: 2 },
        { t: DAY2_STR, value: 2 },
      ]);
    });

    it('breakdown by os splits each day into the exact per-os counts', async () => {
      const res = await postInsights({
        events: [{ name: 'checkout_completed', aggregation: 'total' }],
        date_range: DATE_RANGE,
        interval: 'day',
        breakdown: { property: 'os' },
      }).expect(200);

      expect(res.body.series).toHaveLength(2);
      const ios = res.body.series.find(
        (s: { breakdown_value: string }) => s.breakdown_value === 'ios',
      );
      const android = res.body.series.find(
        (s: { breakdown_value: string }) => s.breakdown_value === 'android',
      );
      expect(ios.data).toEqual([
        { t: DAY1_STR, value: 2 },
        { t: DAY2_STR, value: 1 },
      ]);
      expect(android.data).toEqual([
        { t: DAY1_STR, value: 1 },
        { t: DAY2_STR, value: 2 },
      ]);
    });

    it('a filter (os=ios) narrows the unfiltered per-day total to exactly the ios subset', async () => {
      const res = await postInsights({
        events: [{ name: 'checkout_completed', aggregation: 'total' }],
        date_range: DATE_RANGE,
        interval: 'day',
        filters: [{ property: 'os', op: 'eq', value: 'ios' }],
      }).expect(200);

      expect(res.body.series[0].data).toEqual([
        { t: DAY1_STR, value: 2 },
        { t: DAY2_STR, value: 1 },
      ]);
    });

    it('a custom-property filter (plan=free) narrows correctly (exercises the JSON-property path end-to-end)', async () => {
      const res = await postInsights({
        events: [{ name: 'checkout_completed', aggregation: 'total' }],
        date_range: DATE_RANGE,
        interval: 'day',
        filters: [{ property: 'plan', op: 'eq', value: 'free' }],
      }).expect(200);

      expect(res.body.series[0].data).toEqual([
        { t: DAY1_STR, value: 1 },
        { t: DAY2_STR, value: 2 },
      ]);
    });

    it('multi-event query returns one exact series per event', async () => {
      const res = await postInsights({
        events: [
          { name: 'checkout_completed', aggregation: 'total' },
          { name: 'product_viewed', aggregation: 'total' },
        ],
        date_range: DATE_RANGE,
        interval: 'day',
      }).expect(200);

      expect(res.body.series).toHaveLength(2);
      const checkout = res.body.series.find(
        (s: { name: string }) => s.name === 'checkout_completed',
      );
      const viewed = res.body.series.find((s: { name: string }) => s.name === 'product_viewed');
      expect(checkout.data).toEqual([
        { t: DAY1_STR, value: 3 },
        { t: DAY2_STR, value: 3 },
      ]);
      expect(viewed.data).toEqual([
        { t: DAY1_STR, value: 2 },
        { t: DAY2_STR, value: 2 },
      ]);
    });

    it('400 on an invalid query definition (unknown interval)', async () => {
      await postInsights({
        events: [{ name: 'checkout_completed', aggregation: 'total' }],
        date_range: DATE_RANGE,
        interval: 'fortnight',
      })
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);
    });

    it('400 on more than 5 events', async () => {
      const events = Array.from({ length: 6 }, (_, i) => ({
        name: `evt_${i}`,
        aggregation: 'total',
      }));
      await postInsights({ events, date_range: DATE_RANGE, interval: 'day' }).expect(400);
    });

    it('401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/query/insights`)
        .send({
          events: [{ name: 'checkout_completed', aggregation: 'total' }],
          date_range: DATE_RANGE,
          interval: 'day',
        })
        .expect(401);
    });

    it('403 for a user who is not a member of the project (not 404, not data)', async () => {
      const outsiderSignup = await signup(stack, uniqueEmail());
      const outsiderToken = outsiderSignup.body.access_token;

      await postInsights(
        {
          events: [{ name: 'checkout_completed', aggregation: 'total' }],
          date_range: DATE_RANGE,
          interval: 'day',
        },
        outsiderToken,
      )
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });

  describe('GET /meta/events', () => {
    it('returns exactly the ingested distinct event names', async () => {
      const res = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/events`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual({ events: ['checkout_completed', 'product_viewed'] });
    });

    it('401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/events`)
        .expect(401);
    });
  });

  describe('GET /meta/properties', () => {
    it('returns known columns (type "column") and ingested custom keys (type "string")', async () => {
      const res = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/properties`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.properties).toEqual(
        expect.arrayContaining([
          { name: 'os', type: 'column' },
          { name: 'distinct_id', type: 'column' },
          { name: 'plan', type: 'string' },
        ]),
      );
    });

    it('narrows custom keys to the given event: product_viewed has no `plan` property', async () => {
      const res = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/properties`)
        .query({ event: 'product_viewed' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.properties.some((p: { name: string }) => p.name === 'plan')).toBe(false);
    });

    it('403 for a user who is not a member of the project', async () => {
      const outsiderSignup = await signup(stack, uniqueEmail());
      const outsiderToken = outsiderSignup.body.access_token;

      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/properties`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });

  describe('GET /meta/property-values', () => {
    it('returns distinct values of a custom JSON property, frequency-ranked (tie -> value ASC)', async () => {
      const res = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/property-values`)
        .query({ property: 'plan' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Seed has 3×`pro` and 3×`free` -> tie broken by value ASC.
      expect(res.body.values).toEqual(['free', 'pro']);
    });

    it('returns distinct values of a whitelisted column (os) without interpolating the key', async () => {
      const res = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/property-values`)
        .query({ property: 'os' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect([...res.body.values].sort()).toEqual(['android', 'ios']);
    });

    it('narrows values to one event: product_viewed has no `plan` values', async () => {
      const res = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/property-values`)
        .query({ property: 'plan', event: 'product_viewed' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.values).toEqual([]);
    });

    it('400 when `property` is missing', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/property-values`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);
    });

    it('403 for a user who is not a member of the project', async () => {
      const outsiderSignup = await signup(stack, uniqueEmail());
      const outsiderToken = outsiderSignup.body.access_token;

      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/meta/property-values`)
        .query({ property: 'plan' })
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });
});
