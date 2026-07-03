import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { SlidingWindowRateLimiter } from './rate-limiter';

/**
 * Redis-availability behavior is unit-tested here with a mocked client; the real
 * sliding-window math (allow/deny/slide/per-key isolation) is covered against a
 * live Redis container in test/integration/rate-limiter.int-spec.ts.
 *
 * Policy under test: fail open ONLY when no allow/deny decision could be made
 * (EXEC rejects, returns null, or yields a malformed/errored count). Once EXEC
 * resolves with count > limit, the deny stands even if post-decision cleanup fails.
 */
describe('SlidingWindowRateLimiter (redis failure policy)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeRedis(opts: {
    execRejects?: Error;
    execResolves?: unknown;
    zremRejects?: Error;
    zrangeRejects?: Error;
  }) {
    const chain: Record<string, jest.Mock> = {};
    chain.zremrangebyscore = jest.fn().mockReturnValue(chain);
    chain.zadd = jest.fn().mockReturnValue(chain);
    chain.zcard = jest.fn().mockReturnValue(chain);
    chain.pexpire = jest.fn().mockReturnValue(chain);
    chain.exec = opts.execRejects
      ? jest.fn().mockRejectedValue(opts.execRejects)
      : jest.fn().mockResolvedValue(opts.execResolves);
    const zrem = opts.zremRejects
      ? jest.fn().mockRejectedValue(opts.zremRejects)
      : jest.fn().mockResolvedValue(1);
    const zrange = opts.zrangeRejects
      ? jest.fn().mockRejectedValue(opts.zrangeRejects)
      : jest.fn().mockResolvedValue([]);
    const redis = { multi: jest.fn(() => chain), zrem, zrange } as unknown as Redis;
    return { redis, chain, zrem, zrange };
  }

  /** exec() result shape: [error, reply][] for zremrangebyscore, zadd, zcard, pexpire. */
  function execResultWithCount(count: number): [Error | null, unknown][] {
    return [
      [null, 0],
      [null, 1],
      [null, count],
      [null, 1],
    ];
  }

  describe('no decision could be made (fail open)', () => {
    it('fails open (allows the request) and logs a warning when the MULTI transaction rejects', async () => {
      const { redis, zrem } = makeRedis({ execRejects: new Error('ECONNREFUSED') });
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

    it('fails open with a warning when exec() resolves to null', async () => {
      const { redis, zrem } = makeRedis({ execResolves: null });
      const limiter = new SlidingWindowRateLimiter(redis);

      const result = await limiter.consume('ingest:some-token', 1000);

      expect(result).toEqual({ allowed: true, remaining: 1000, retryAfterSeconds: 0 });
      expect(warnSpy).toHaveBeenCalled();
      expect(zrem).not.toHaveBeenCalled();
    });

    it('fails open with a warning when the zcard entry carries a per-command error', async () => {
      const { redis, zrem } = makeRedis({
        execResolves: [
          [null, 0],
          [null, 1],
          [new Error('WRONGTYPE Operation against a key holding the wrong kind of value'), null],
          [null, 1],
        ],
      });
      const limiter = new SlidingWindowRateLimiter(redis);

      const result = await limiter.consume('ingest:some-token', 1000);

      expect(result).toEqual({ allowed: true, remaining: 1000, retryAfterSeconds: 0 });
      expect(warnSpy).toHaveBeenCalled();
      expect(zrem).not.toHaveBeenCalled();
    });

    it('fails open with a warning when the zcard reply is not a number (malformed results)', async () => {
      const { redis } = makeRedis({
        execResolves: [
          [null, 0],
          [null, 1],
          [null, 'not-a-count'],
          [null, 1],
        ],
      });
      const limiter = new SlidingWindowRateLimiter(redis);

      const result = await limiter.consume('ingest:some-token', 1000);

      expect(result).toEqual({ allowed: true, remaining: 1000, retryAfterSeconds: 0 });
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('deny decision already made (deny stands)', () => {
    it('still denies with a full-window retry hint when zrem fails after an over-limit count', async () => {
      const { redis, zrem } = makeRedis({
        execResolves: execResultWithCount(1001),
        zremRejects: new Error('ECONNRESET'),
      });
      const limiter = new SlidingWindowRateLimiter(redis);

      const result = await limiter.consume('ingest:some-token', 1000);

      expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
      expect(zrem).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('still denies with a full-window retry hint when zrange fails after an over-limit count', async () => {
      const { redis, zrem, zrange } = makeRedis({
        execResolves: execResultWithCount(1001),
        zrangeRejects: new Error('ECONNRESET'),
      });
      const limiter = new SlidingWindowRateLimiter(redis);

      const result = await limiter.consume('ingest:some-token', 1000);

      expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
      expect(zrem).toHaveBeenCalled();
      expect(zrange).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
