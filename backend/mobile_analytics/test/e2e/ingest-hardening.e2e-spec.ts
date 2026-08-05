import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ClickHouseClient } from '@clickhouse/client';
import { startTestStack, TestStack } from './helpers/stack';

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: Date.now(),
    ...overrides,
  };
}

async function countDistinct(ch: ClickHouseClient, insertId: string): Promise<number> {
  const rs = await ch.query({
    query: 'SELECT count(DISTINCT insert_id) AS n FROM events WHERE insert_id = {id:UUID}',
    query_params: { id: insertId },
    format: 'JSONEachRow',
  });
  const rows = await rs.json<{ n: string }>();
  return Number(rows[0].n);
}

// Test order matters: the stack runs with INGEST_RATE_LIMIT_PER_MIN=5 and only requests
// that pass the auth guard consume the limiter. 401s (auth guard rejects first) and 413s
// (body parser rejects before any guard) consume nothing. Budget: dedup uses slots 1-2,
// the final test uses slots 3-5 and then trips slot 6.
describe('/ingest hardening (e2e): auth, limits, dedup, health', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack({ INGEST_RATE_LIMIT_PER_MIN: '5', INGEST_MAX_BODY_KB: '2' });
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('401 problem without an Authorization header', async () => {
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .send({ events: [makeEvent()] })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ type: 'about:blank', title: 'Unauthorized', status: 401 });
  });

  it('401 problem for a malformed token', async () => {
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', 'Bearer not-a-token')
      .send({ events: [makeEvent()] })
      .expect(401);
  });

  it('401 problem for a well-formed but unknown token', async () => {
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', 'Bearer mam_' + 'f'.repeat(32))
      .send({ events: [makeEvent()] })
      .expect(401);
  });

  it('401 problem for a revoked token', async () => {
    const revoked = 'mam_' + randomBytes(16).toString('hex');
    await stack.prisma.sdkToken.create({
      data: { projectId: stack.projectId, token: revoked, label: 'revoked', revokedAt: new Date() },
    });
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${revoked}`)
      .send({ events: [makeEvent()] })
      .expect(401);
  });

  // Carry-forward (Task 8/9 review): the body-size cap must hold against the *decompressed*
  // payload, not the wire size — body-parser's `limit` is enforced on the inflated stream, so a
  // small gzip body that unpacks past INGEST_MAX_BODY_KB must still 413 (otherwise a compressible
  // "zip bomb" style payload would sail through the cap under Content-Encoding: gzip).
  it('413 problem when a gzip body decompresses past INGEST_MAX_BODY_KB', async () => {
    const fat = makeEvent({ properties: { pad: 'x'.repeat(8192) } });
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      // Bypass superagent's JSON serializer so the raw gzip bytes are sent unmodified
      // (same workaround as the Task 8 json-body.middleware.spec.ts gzip case).
      .serialize((body) => body as string)
      .send(gzipSync(JSON.stringify({ events: [fat] })))
      .expect(413)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 413, title: 'Payload Too Large' });
  });

  it('deduplicates a retried batch by insert_id (2 requests, 1 logical event)', async () => {
    const event = makeEvent();
    const send = () =>
      request(stack.app.getHttpServer())
        .post('/ingest/events')
        .set('Authorization', `Bearer ${stack.sdkToken}`)
        .send({ events: [event] })
        .expect(202);
    await send(); // rate-limit slot 1
    await send(); // rate-limit slot 2 — simulated SDK retry after a network timeout
    // Dedup is eventual (ReplacingMergeTree); exactness queries always use count(DISTINCT insert_id).
    expect(await countDistinct(stack.ch, event.insert_id as string)).toBe(1);
  });

  it('health endpoints report live and ready with all dependencies up', async () => {
    const live = await request(stack.app.getHttpServer()).get('/health').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await request(stack.app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body).toEqual({
      status: 'ready',
      checks: { postgres: true, clickhouse: true, redis: true },
    });
  });

  it('429 problem with Retry-After once the sliding window is exhausted', async () => {
    // Rate-limit slots 3, 4, 5.
    for (let i = 0; i < 3; i += 1) {
      await request(stack.app.getHttpServer())
        .post('/ingest/events')
        .set('Authorization', `Bearer ${stack.sdkToken}`)
        .send({ events: [makeEvent()] })
        .expect(202);
    }
    // Slot 6 → denied.
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [makeEvent()] })
      .expect(429)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});
