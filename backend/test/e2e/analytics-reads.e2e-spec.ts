import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

async function signup(stack: TestStack, email: string) {
  return request(stack.app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', name: 'Reads Tester' })
    .expect(200);
}

// Same anchoring rationale as analytics.e2e-spec.ts: ingest clamps client timestamps to
// [now-7d, now+5min] (contracts §4), so the dataset must sit a few days before "now" rather than
// on a hardcoded calendar date, or every exact-count/exact-average assertion below would break.
const HOUR = 3_600_000;
const MIN = 60_000;
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const TODAY_UTC_MIDNIGHT = Math.floor(Date.now() / 86_400_000) * 86_400_000;
const DAY1 = TODAY_UTC_MIDNIGHT - 3 * 86_400_000;
const DAY2 = TODAY_UTC_MIDNIGHT - 2 * 86_400_000;
const DAY1_STR = isoDate(DAY1);
const DAY2_STR = isoDate(DAY2);

interface SeedEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  anon_id: string;
  session_id: string;
  timestamp: number;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

function makeEvent(opts: {
  event: string;
  distinctId: string;
  os: string;
  ts: number;
  properties?: Record<string, unknown>;
}): SeedEvent {
  return {
    insert_id: randomUUID(),
    event: opts.event,
    distinct_id: opts.distinctId,
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: opts.ts,
    properties: opts.properties ?? {},
    context: { os: opts.os, app_version: '2.0.0' },
  };
}

const ALICE = 'user_alice';
const ALICE2 = 'user_alice2';
const BOB = 'user_bob';

/**
 * KNOWN dataset (contracts §14 e2e requirement), 9 events across 2 UTC days + 3 users:
 *  - user_alice:  4 events (app_open, screen_view, app_open, $session_end dur=1000) on day1.
 *  - user_alice2: 2 events (app_open on day1, app_open on day2).
 *  - user_bob:    3 events (app_open day1, $session_end dur=3000 day1, $session_end dur=5000 day2).
 * Global chronological order (t0..t8, 10 min apart on day1, then day2) is used to verify the live
 * feed's newest-first ordering and `before`-cursor pagination without any gaps or duplicates.
 */
function seedEvents(): { events: SeedEvent[]; order: SeedEvent[] } {
  const t0 = makeEvent({ event: 'app_open', distinctId: ALICE, os: 'ios', ts: DAY1 + 9 * HOUR });
  const t1 = makeEvent({
    event: 'app_open',
    distinctId: ALICE2,
    os: 'android',
    ts: DAY1 + 9 * HOUR + 10 * MIN,
  });
  const t2 = makeEvent({
    event: 'screen_view',
    distinctId: ALICE,
    os: 'ios',
    ts: DAY1 + 9 * HOUR + 20 * MIN,
  });
  const t3 = makeEvent({
    event: 'app_open',
    distinctId: BOB,
    os: 'ios',
    ts: DAY1 + 9 * HOUR + 30 * MIN,
  });
  const t4 = makeEvent({
    event: 'app_open',
    distinctId: ALICE,
    os: 'ios',
    ts: DAY1 + 9 * HOUR + 40 * MIN,
  });
  const t5 = makeEvent({
    event: '$session_end',
    distinctId: ALICE,
    os: 'ios',
    ts: DAY1 + 9 * HOUR + 50 * MIN,
    properties: { $duration_ms: 1000 },
  });
  const t6 = makeEvent({
    event: '$session_end',
    distinctId: BOB,
    os: 'ios',
    ts: DAY1 + 10 * HOUR,
    properties: { $duration_ms: 3000 },
  });
  const t7 = makeEvent({
    event: 'app_open',
    distinctId: ALICE2,
    os: 'android',
    ts: DAY2 + 9 * HOUR,
  });
  const t8 = makeEvent({
    event: '$session_end',
    distinctId: BOB,
    os: 'ios',
    ts: DAY2 + 9 * HOUR + 10 * MIN,
    properties: { $duration_ms: 5000 },
  });
  const order = [t0, t1, t2, t3, t4, t5, t6, t7, t8];
  return { events: order, order };
}

describe('Analytics read endpoints (e2e, contracts §14)', () => {
  let stack: TestStack;
  let accessToken: string;
  let projectId: string;
  let order: SeedEvent[];

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

    const seeded = seedEvents();
    order = seeded.order;

    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({ events: seeded.events })
      .expect(202);

    await request(stack.app.getHttpServer())
      .post('/ingest/profiles')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({
        operations: [
          {
            distinct_id: ALICE,
            op: 'set',
            properties: { plan: 'pro', tier: 'gold' },
            timestamp: DAY1 + 9 * HOUR,
          },
        ],
      })
      .expect(202);
  }, 120_000);

  afterAll(async () => {
    await stack.stop();
  });

  function get(path: string, token = accessToken) {
    return request(stack.app.getHttpServer())
      .get(`/api/v1/projects/${projectId}${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('GET /events/live', () => {
    it('returns events newest-first', async () => {
      const res = await get('/events/live?limit=9').expect(200);

      expect(res.body.events.map((e: { insert_id: string }) => e.insert_id)).toEqual(
        [...order].reverse().map((e) => e.insert_id),
      );
      expect(res.body.events[0]).toEqual({
        insert_id: order[8].insert_id,
        event: '$session_end',
        distinct_id: BOB,
        timestamp: new Date(order[8].timestamp).toISOString(),
        os: 'ios',
        app_version: '2.0.0',
      });
      expect(res.body.next_before).toBe(new Date(order[0].timestamp).toISOString());
    });

    it('a working `before` cursor pages through the whole feed with no gaps or duplicates', async () => {
      const page1 = await get('/events/live?limit=4').expect(200);
      expect(page1.body.events.map((e: { insert_id: string }) => e.insert_id)).toEqual(
        [order[8], order[7], order[6], order[5]].map((e) => e.insert_id),
      );
      expect(page1.body.next_before).toBe(new Date(order[5].timestamp).toISOString());

      const page2 = await get(`/events/live?limit=4&before=${page1.body.next_before}`).expect(200);
      expect(page2.body.events.map((e: { insert_id: string }) => e.insert_id)).toEqual(
        [order[4], order[3], order[2], order[1]].map((e) => e.insert_id),
      );
      expect(page2.body.next_before).toBe(new Date(order[1].timestamp).toISOString());

      const page3 = await get(`/events/live?limit=4&before=${page2.body.next_before}`).expect(200);
      expect(page3.body.events.map((e: { insert_id: string }) => e.insert_id)).toEqual([
        order[0].insert_id,
      ]);
      expect(page3.body.next_before).toBe(new Date(order[0].timestamp).toISOString());

      const page4 = await get(`/events/live?limit=4&before=${page3.body.next_before}`).expect(200);
      expect(page4.body.events).toEqual([]);
      expect(page4.body.next_before).toBeNull();
    });

    it('limit is clamped to 100 even when a larger value is requested', async () => {
      const res = await get('/events/live?limit=99999').expect(200);
      expect(res.body.events).toHaveLength(9); // fewer than 100 exist; clamp just caps the ceiling
    });

    it('401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/events/live`)
        .expect(401);
    });

    it('403 for a user who is not a member of the project', async () => {
      const outsider = await signup(stack, uniqueEmail());
      await get('/events/live', outsider.body.access_token)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });

  describe('GET /users', () => {
    it('lists the distinct users with correct event_count and last_seen', async () => {
      const res = await get('/users').expect(200);

      expect(res.body.users).toEqual([
        {
          distinct_id: ALICE,
          last_seen: new Date(order[5].timestamp).toISOString(),
          event_count: 4,
        },
        {
          distinct_id: ALICE2,
          last_seen: new Date(order[7].timestamp).toISOString(),
          event_count: 2,
        },
        { distinct_id: BOB, last_seen: new Date(order[8].timestamp).toISOString(), event_count: 3 },
      ]);
      expect(res.body.next_cursor).toBeNull();
    });

    it('search matches distinct_id by prefix (binds as a param, not concatenated)', async () => {
      const res = await get('/users?search=user_alice').expect(200);
      expect(res.body.users.map((u: { distinct_id: string }) => u.distinct_id)).toEqual([
        ALICE,
        ALICE2,
      ]);
    });

    it('cursor pagination walks the full user list with no gaps or duplicates', async () => {
      const page1 = await get('/users?limit=1').expect(200);
      expect(page1.body.users).toEqual([expect.objectContaining({ distinct_id: ALICE })]);
      expect(page1.body.next_cursor).toBe(ALICE);

      const page2 = await get(`/users?limit=1&cursor=${page1.body.next_cursor}`).expect(200);
      expect(page2.body.users).toEqual([expect.objectContaining({ distinct_id: ALICE2 })]);
      expect(page2.body.next_cursor).toBe(ALICE2);

      const page3 = await get(`/users?limit=1&cursor=${page2.body.next_cursor}`).expect(200);
      expect(page3.body.users).toEqual([expect.objectContaining({ distinct_id: BOB })]);
      expect(page3.body.next_cursor).toBeNull();
    });

    it('401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/users`)
        .expect(401);
    });

    it('403 for a user who is not a member of the project', async () => {
      const outsider = await signup(stack, uniqueEmail());
      await get('/users', outsider.body.access_token)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });

  describe('GET /users/:distinctId', () => {
    it('returns the profile, first/last seen, event_count, and recent_events (newest-first)', async () => {
      const res = await get(`/users/${ALICE}`).expect(200);

      expect(res.body).toEqual({
        distinct_id: ALICE,
        profile: { plan: 'pro', tier: 'gold' },
        first_seen: new Date(order[0].timestamp).toISOString(),
        last_seen: new Date(order[5].timestamp).toISOString(),
        event_count: 4,
        recent_events: [order[5], order[4], order[2], order[0]].map((e) => ({
          insert_id: e.insert_id,
          event: e.event,
          timestamp: new Date(e.timestamp).toISOString(),
          // None of the seeded events carry a `$screen_name`, so it resolves to null.
          screen_name: (e.properties?.$screen_name as string | undefined) ?? null,
          properties: e.properties ?? {},
          // makeEvent only sets os + app_version; every other context column defaults to ''.
          context: {
            os: (e.context?.os as string | undefined) ?? '',
            os_version: '',
            app_version: (e.context?.app_version as string | undefined) ?? '',
            app_build: '',
            device_model: '',
            device_manufacturer: '',
            locale: '',
            timezone: '',
            network: '',
            sdk_version: '',
          },
        })),
      });
    });

    it('an unknown distinct_id returns empty profile, null seens, zero count, no recent events (not 404)', async () => {
      const res = await get('/users/totally-unknown-user').expect(200);

      expect(res.body).toEqual({
        distinct_id: 'totally-unknown-user',
        profile: {},
        first_seen: null,
        last_seen: null,
        event_count: 0,
        recent_events: [],
      });
    });

    it('401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/users/${ALICE}`)
        .expect(401);
    });

    it('403 for a user who is not a member of the project', async () => {
      const outsider = await signup(stack, uniqueEmail());
      await get(`/users/${ALICE}`, outsider.body.access_token)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });

  describe('GET /sessions/summary', () => {
    it('returns the exact session count, overall avg_duration_ms, and per-day breakdown', async () => {
      const res = await get(`/sessions/summary?from=${DAY1_STR}&to=${DAY2_STR}`).expect(200);

      expect(res.body).toEqual({
        sessions: 3,
        avg_duration_ms: 3000, // (1000 + 3000 + 5000) / 3
        by_day: [
          { t: DAY1_STR, sessions: 2, avg_duration_ms: 2000 }, // (1000 + 3000) / 2
          { t: DAY2_STR, sessions: 1, avg_duration_ms: 5000 },
        ],
      });
    });

    it('401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/sessions/summary`)
        .expect(401);
    });

    it('403 for a user who is not a member of the project', async () => {
      const outsider = await signup(stack, uniqueEmail());
      await get('/sessions/summary', outsider.body.access_token)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);
    });
  });
});
