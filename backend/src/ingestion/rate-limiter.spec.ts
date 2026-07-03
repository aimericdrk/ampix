import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { SlidingWindowRateLimiter } from './rate-limiter';

/**
 * Redis-availability behavior is unit-tested here with a mocked client; the real
 * sliding-window math (allow/deny/slide/per-key isolation) is covered against a
 * live Redis container in test/integration/rate-limiter.int-spec.ts.
 */
describe('SlidingWindowRateLimiter (redis failure policy)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeRejectingRedis(error: Error) {
    const chain: Record<string, jest.Mock> = {};
    chain.zremrangebyscore = jest.fn().mockReturnValue(chain);
    chain.zadd = jest.fn().mockReturnValue(chain);
    chain.zcard = jest.fn().mockReturnValue(chain);
    chain.pexpire = jest.fn().mockReturnValue(chain);
    chain.exec = jest.fn().mockRejectedValue(error);
    const zrem = jest.fn();
    const zrange = jest.fn();
    const redis = { multi: jest.fn(() => chain), zrem, zrange } as unknown as Redis;
    return { redis, chain, zrem, zrange };
  }

  it('fails open (allows the request) and logs a warning when the MULTI transaction rejects', async () => {
    const { redis, zrem } = makeRejectingRedis(new Error('ECONNREFUSED'));
    const limiter = new SlidingWindowRateLimiter(redis);

    const result = await limiter.consume('ingest:some-token', 1000);

    expect(result).toEqual({ allowed: true, remaining: 1000, retryAfterSeconds: 0 });
    expect(warnSpy).toHaveBeenCalled();
    // A denied request removes its own member; a failed-open request must not do so.
    expect(zrem).not.toHaveBeenCalled();
  });

  it('fails open when the connection is down entirely (multi() throws synchronously)', async () => {
    const redis = {
      multi: jest.fn(() => {
        throw new Error('connection is closed');
      }),
      zrem: jest.fn(),
      zrange: jest.fn(),
    } as unknown as Redis;
    const limiter = new SlidingWindowRateLimiter(redis);

    const result = await limiter.consume('ingest:some-token', 1000);

    expect(result).toEqual({ allowed: true, remaining: 1000, retryAfterSeconds: 0 });
    expect(warnSpy).toHaveBeenCalled();
  });
});
