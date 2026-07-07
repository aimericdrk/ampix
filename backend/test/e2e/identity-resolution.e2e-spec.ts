import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

/**
 * Identity resolution (contracts §17) end-to-end against a REAL ClickHouse (testcontainers): the
 * anonymous→identified merge. We ingest a KNOWN sequence for ONE physical user through the real
 * /ingest API — N anonymous events (`distinct_id = <anon>`), a reserved `$identify` event
 * (`distinct_id = <user>`, property `$anon_id = <anon>`), then M identified events
 * (`distinct_id = <user>`) — plus a separate unrelated user, and assert the read side merges the
 * two id-spaces into ONE user (the whole bug this section fixes).
 *
 * Timestamps are anchored to the ACTUAL current time: ingestion clamps client timestamps to
 * [now-7d, now+5min] (contracts §4), so the dataset sits a couple of days back to clear the 7-day
 * floor while keeping the exact-count assertions stable.
 */

const HOUR = 3_600_000;
const MIN = 60_000;
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const TODAY_UTC_MIDNIGHT = Math.floor(Date.now() / 86_400_000) * 86_400_000;
const DAY = TODAY_UTC_MIDNIGHT - 2 * 86_400_000;
const DAY_STR = isoDate(DAY);

// One physical user, two id-spaces linked by $identify; plus an unrelated user.
const ANON = 'anon-dana-018f6b2e';
const USER = 'user-dana-42';
const EVE = 'user-eve-99';
const N_ANON = 3; // anonymous events before login
const M_IDENTIFIED = 2; // events after login
const MERGED_EVENT_COUNT = N_ANON + M_IDENTIFIED + 1; // + the $identify event itself

function makeEvent(opts: {
  event: string;
  distinctId: string;
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
    context: { os: 'ios', app_version: '1.0.0' },
  };
}

/**
 * KNOWN sequence for user "Dana":
 *  - N anonymous `app_open` events           (distinct_id = ANON)
 *  - one reserved `$identify`                (distinct_id = USER, properties.$anon_id = ANON)
 *  - M identified `app_open` events          (distinct_id = USER)
 *  Plus unrelated "Eve": one `app_open`      (distinct_id = EVE)
 * Merged, Dana is ONE user (USER) with N + M + 1 = 6 events; unique `app_open` users = { Dana, Eve }.
 */
function seedEvents(): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (let i = 0; i < N_ANON; i++) {
    events.push({
      ...makeEvent({ event: 'app_open', distinctId: ANON, ts: DAY + 9 * HOUR + i * MIN }),
    });
  }
  events.push(
    makeEvent({
      event: '$identify',
      distinctId: USER,
      ts: DAY + 10 * HOUR,
      properties: { $anon_id: ANON },
    }),
  );
  for (let i = 0; i < M_IDENTIFIED; i++) {
    events.push(makeEvent({ event: 'app_open', distinctId: USER, ts: DAY + 11 * HOUR + i * MIN }));
  }
  events.push(makeEvent({ event: 'app_open', distinctId: EVE, ts: DAY + 12 * HOUR }));
  return events;
}

describe('Identity resolution (e2e, contracts §17)', () => {
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
      .send({
        email: `identity-${randomUUID()}@example.com`,
        password: 'password123',
        name: 'Identity Tester',
      })
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

  function get(path: string) {
    return request(stack.app.getHttpServer())
      .get(`/api/v1/projects/${projectId}${path}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  describe('GET /users', () => {
    it('returns ONE merged user for the physical person (not two), keyed by the canonical id', async () => {
      const res = await get('/users').expect(200);

      const ids = res.body.users.map((u: { distinct_id: string }) => u.distinct_id);
      // The pre-login anonymous id is NOT its own user — it merged into the identified user.
      expect(ids).not.toContain(ANON);
      // Exactly two users overall: merged Dana + unrelated Eve.
      expect(ids.sort()).toEqual([USER, EVE].sort());

      const dana = res.body.users.find((u: { distinct_id: string }) => u.distinct_id === USER);
      expect(dana.event_count).toBe(MERGED_EVENT_COUNT); // N + M + the $identify event = 6
      const eve = res.body.users.find((u: { distinct_id: string }) => u.distinct_id === EVE);
      expect(eve.event_count).toBe(1);
    });

    it('search by the canonical id prefix finds the merged user', async () => {
      const res = await get('/users?search=user-dana').expect(200);
      expect(res.body.users.map((u: { distinct_id: string }) => u.distinct_id)).toEqual([USER]);
    });
  });

  describe('GET /users/:distinctId', () => {
    it('the merged profile counts every event across both id-spaces (N + M + identify)', async () => {
      const res = await get(`/users/${USER}`).expect(200);
      expect(res.body.distinct_id).toBe(USER);
      expect(res.body.event_count).toBe(MERGED_EVENT_COUNT);
      // recent_events span both id-spaces (they are all this one person's events).
      expect(res.body.recent_events).toHaveLength(MERGED_EVENT_COUNT);
      // Each recent event carries a screen_name key (null here — none of the seeded events set one).
      for (const ev of res.body.recent_events) {
        expect(ev).toHaveProperty('screen_name');
      }
      // §17 identity set: the canonical id PLUS the pre-login anon_id that merged into it — this is
      // what the per-user click-heatmap filters the raw distinct_id column on to stay identity-correct.
      expect(res.body.distinct_ids.sort()).toEqual([USER, ANON].sort());
    });

    it('requesting the pre-login anon_id redirects to the canonical merged profile', async () => {
      const res = await get(`/users/${ANON}`).expect(200);
      // Resolves the anon to its canonical user and returns THAT user's merged profile.
      expect(res.body.distinct_id).toBe(USER);
      expect(res.body.event_count).toBe(MERGED_EVENT_COUNT);
      // The identity set is computed from the canonical id, so it is identical regardless of which
      // id-space the caller queried by.
      expect(res.body.distinct_ids.sort()).toEqual([USER, ANON].sort());
    });
  });

  describe('POST /query/insights unique_users', () => {
    it('counts the anonymous→identified person exactly ONCE', async () => {
      const res = await request(stack.app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/query/insights`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          events: [{ name: 'app_open', aggregation: 'unique_users' }],
          date_range: { from: DAY_STR, to: DAY_STR },
          interval: 'day',
        })
        .expect(200);

      // Dana (merged, once) + Eve (once) = 2 — NOT 3 (which the pre-fix raw distinct_id count gave).
      const total = res.body.series[0].data.reduce(
        (sum: number, p: { value: number }) => sum + p.value,
        0,
      );
      expect(total).toBe(2);
    });

    it('total (event count) is unaffected by the merge — every app_open row still counts', async () => {
      const res = await request(stack.app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/query/insights`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          events: [{ name: 'app_open', aggregation: 'total' }],
          date_range: { from: DAY_STR, to: DAY_STR },
          interval: 'day',
        })
        .expect(200);

      const total = res.body.series[0].data.reduce(
        (sum: number, p: { value: number }) => sum + p.value,
        0,
      );
      // N anon + M identified app_opens + Eve's one = 6 rows (the $identify event is a different name).
      expect(total).toBe(N_ANON + M_IDENTIFIED + 1);
    });
  });
});
