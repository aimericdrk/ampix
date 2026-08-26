import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
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
    properties: { plan: 'pro', value: 9.99 },
    context: { os: 'ios', app_version: '1.4.2' },
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

describe('POST /ingest/events (e2e)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('accepts valid items and rejects invalid ones per-item with 202', async () => {
    const good = makeEvent();
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [good, { event: 'missing_everything' }] })
      .expect(202);
    expect(res.body).toEqual({
      accepted: 1,
      rejected: [{ index: 1, reason: 'missing insert_id' }],
    });
    expect(await countDistinct(stack.ch, good.insert_id as string)).toBe(1);
  });

  it('accepts gzip-encoded bodies (Content-Encoding: gzip)', async () => {
    const good = makeEvent();
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      // Bypass superagent's JSON serializer so the raw gzip bytes are sent unmodified
      // (same workaround as the Task 8 json-body.middleware.spec.ts gzip case).
      .serialize((body) => body as string)
      .send(gzipSync(JSON.stringify({ events: [good] })))
      .expect(202);
    expect(res.body.accepted).toBe(1);
    expect(await countDistinct(stack.ch, good.insert_id as string)).toBe(1);
  });

  it('returns a 400 problem for malformed JSON', async () => {
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .set('Content-Type', 'application/json')
      .send('{"events": [')
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({
      status: 400,
      title: 'Bad Request',
      detail: 'Malformed JSON body',
    });
  });

  it('returns a 400 problem for a missing or empty events array', async () => {
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ nope: [] })
      .expect(400);
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [] })
      .expect(400);
  });

  it('returns a 400 problem when the batch exceeds INGEST_MAX_BATCH=100', async () => {
    const events = Array.from({ length: 101 }, () => makeEvent());
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events })
      .expect(400);
    expect(res.body.detail).toContain('INGEST_MAX_BATCH=100');
  });

  // The whole point of token-borne attribution: two tokens on the same project, two sources, and
  // the payload has no say in it.
  it('classifies each batch by the token it was sent with, ignoring any source in the payload', async () => {
    const serverToken = 'mam_' + randomUUID().replace(/-/g, '');
    await stack.prisma.sdkToken.create({
      data: {
        projectId: stack.projectId,
        token: serverToken,
        label: 'e2e-server',
        source: 'server',
      },
    });

    const fromApp = makeEvent({ source: 'server' }); // client token, lying about its source
    const fromBackend = makeEvent();

    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [fromApp] })
      .expect(202);
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${serverToken}`)
      .send({ events: [fromBackend] })
      .expect(202);

    const rs = await stack.ch.query({
      query: 'SELECT insert_id, source FROM events WHERE insert_id IN ({a:UUID}, {b:UUID})',
      query_params: { a: fromApp.insert_id, b: fromBackend.insert_id },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ insert_id: string; source: string }>();
    const sourceOf = (id: unknown) => rows.find((r) => r.insert_id === id)?.source;
    expect(sourceOf(fromApp.insert_id)).toBe('client');
    expect(sourceOf(fromBackend.insert_id)).toBe('server');
  });

  it('clamps stale client timestamps to now-7d and stamps server_timestamp', async () => {
    const stale = makeEvent({ timestamp: 1000 });
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [stale] })
      .expect(202);

    const rs = await stack.ch.query({
      query:
        'SELECT toUnixTimestamp64Milli(timestamp) AS ts, toUnixTimestamp64Milli(server_timestamp) AS sts ' +
        'FROM events WHERE insert_id = {id:UUID} LIMIT 1',
      query_params: { id: stale.insert_id },
      format: 'JSONEachRow',
    });
    const [row] = await rs.json<{ ts: string; sts: string }>();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    expect(Number(row.ts)).toBeGreaterThan(sevenDaysAgo - 60_000);
    expect(Number(row.ts)).toBeLessThan(sevenDaysAgo + 60_000);
    expect(Math.abs(Number(row.sts) - now)).toBeLessThan(60_000);
  });
});
