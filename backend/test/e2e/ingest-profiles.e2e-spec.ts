import request from 'supertest';
import { startTestStack, TestStack } from './helpers/stack';

describe('POST /ingest/profiles (e2e)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    await stack.stop();
  });

  async function fetchProfile(distinctId: string): Promise<Record<string, unknown> | undefined> {
    const rs = await stack.ch.query({
      query:
        'SELECT properties FROM user_profiles FINAL WHERE project_id = {p:UUID} AND distinct_id = {d:String}',
      query_params: { p: stack.projectId, d: distinctId },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ properties: Record<string, unknown> }>();
    return rows[0]?.properties;
  }

  function post(operations: unknown[]) {
    return request(stack.app.getHttpServer())
      .post('/ingest/profiles')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ operations });
  }

  it('applies set / set_once / increment / append in one request (202)', async () => {
    const res = await post([
      { distinct_id: 'u_100', op: 'set', properties: { plan: 'free', seats: 1 }, timestamp: 1 },
      {
        distinct_id: 'u_100',
        op: 'set_once',
        properties: { plan: 'pro', source: 'ad' },
        timestamp: 2,
      },
      { distinct_id: 'u_100', op: 'increment', properties: { seats: 2 }, timestamp: 3 },
      { distinct_id: 'u_100', op: 'append', properties: { tags: 'beta' }, timestamp: 4 },
    ]).expect(202);
    expect(res.body).toEqual({ accepted: 4, rejected: [] });
    expect(await fetchProfile('u_100')).toEqual({
      plan: 'free',
      seats: 3,
      source: 'ad',
      tags: ['beta'],
    });
  });

  it('merges follow-up requests onto the stored profile and supports unset/delete', async () => {
    await post([
      { distinct_id: 'u_101', op: 'set', properties: { a: 1, b: 2 }, timestamp: 1 },
    ]).expect(202);
    await post([
      { distinct_id: 'u_101', op: 'unset', properties: { a: null }, timestamp: 2 },
    ]).expect(202);
    expect(await fetchProfile('u_101')).toEqual({ b: 2 });
    await post([{ distinct_id: 'u_101', op: 'delete', timestamp: 3 }]).expect(202);
    expect(await fetchProfile('u_101')).toEqual({});
  });

  it('rejects invalid operations per-item and still applies the valid ones', async () => {
    const res = await post([
      { distinct_id: 'u_102', op: 'merge', properties: {}, timestamp: 1 },
      { distinct_id: 'u_102', op: 'set', properties: { x: 1 }, timestamp: 2 },
    ]).expect(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].index).toBe(0);
    expect(res.body.rejected[0].reason).toMatch(/^op/);
    expect(await fetchProfile('u_102')).toEqual({ x: 1 });
  });
});
