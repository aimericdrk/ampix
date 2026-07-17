import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';
import { startRedisContainer } from './helpers/containers';

describe('Redis client (integration)', () => {
  let container: StartedTestContainer;
  let redis: Redis;

  beforeAll(async () => {
    const started = await startRedisContainer();
    container = started.container;
    redis = new Redis(started.url, { maxRetriesPerRequest: 2 });
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  it('pings and round-trips a key with TTL', async () => {
    expect(await redis.ping()).toBe('PONG');
    await redis.set('k', 'v', 'EX', 60);
    expect(await redis.get('k')).toBe('v');
    expect(await redis.ttl('k')).toBeGreaterThan(0);
  });
});
