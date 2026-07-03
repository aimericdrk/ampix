import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';
import { SlidingWindowRateLimiter } from '../../src/ingestion/rate-limiter';
import { startRedisContainer } from './helpers/containers';

describe('SlidingWindowRateLimiter (integration)', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let limiter: SlidingWindowRateLimiter;

  beforeAll(async () => {
    const started = await startRedisContainer();
    container = started.container;
    redis = new Redis(started.url, { maxRetriesPerRequest: 2 });
    limiter = new SlidingWindowRateLimiter(redis);
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  it('allows up to the limit inside the window, then denies with a retry hint', async () => {
    const key = 'ingest:test-token-1';
    const first = await limiter.consume(key, 3, 1500);
    const second = await limiter.consume(key, 3, 1500);
    const third = await limiter.consume(key, 3, 1500);
    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    expect(first.remaining).toBe(2);
    expect(third.remaining).toBe(0);

    const fourth = await limiter.consume(key, 3, 1500);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('allows again once the window slides past the old entries', async () => {
    const key = 'ingest:test-token-2';
    for (let i = 0; i < 3; i += 1) {
      await limiter.consume(key, 3, 1500);
    }
    expect((await limiter.consume(key, 3, 1500)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect((await limiter.consume(key, 3, 1500)).allowed).toBe(true);
  });

  it('tracks independent windows per key', async () => {
    expect((await limiter.consume('ingest:token-a', 1, 1500)).allowed).toBe(true);
    expect((await limiter.consume('ingest:token-b', 1, 1500)).allowed).toBe(true);
    expect((await limiter.consume('ingest:token-a', 1, 1500)).allowed).toBe(false);
  });
});
