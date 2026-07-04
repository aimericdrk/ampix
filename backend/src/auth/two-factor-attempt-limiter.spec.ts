import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { ProblemException } from '../common/problem-details';
import {
  TWO_FACTOR_ATTEMPT_LIMIT,
  TWO_FACTOR_ATTEMPT_WINDOW_MS,
  TwoFactorAttemptLimiter,
} from './two-factor-attempt-limiter';

/**
 * Policy under test: FAIL CLOSED. Unlike `SlidingWindowRateLimiter` (ingestion/rate-limiter.ts),
 * which fails open when no allow/deny decision can be made, this limiter guards TOTP/recovery-code
 * guessing — so ANY Redis error (transaction rejects, resolves null, or yields a malformed/errored
 * count) must DENY the attempt rather than let it through.
 */
describe('TwoFactorAttemptLimiter', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function makeRedis(opts: {
    execRejects?: Error;
    execResolves?: unknown;
    pttlRejects?: Error;
    pttlResolves?: number;
  }) {
    const chain: Record<string, jest.Mock> = {};
    chain.incr = jest.fn().mockReturnValue(chain);
    chain.pexpire = jest.fn().mockReturnValue(chain);
    chain.exec = opts.execRejects
      ? jest.fn().mockRejectedValue(opts.execRejects)
      : jest.fn().mockResolvedValue(opts.execResolves);
    const pttl = opts.pttlRejects
      ? jest.fn().mockRejectedValue(opts.pttlRejects)
      : jest.fn().mockResolvedValue(opts.pttlResolves ?? TWO_FACTOR_ATTEMPT_WINDOW_MS);
    const redis = { multi: jest.fn(() => chain), pttl } as unknown as Redis;
    return { redis, chain, pttl };
  }

  /** exec() result shape: [error, reply][] for incr, pexpire. */
  function execResultWithCount(count: number): [Error | null, unknown][] {
    return [
      [null, count],
      [null, 1],
    ];
  }

  describe('happy path (under the limit)', () => {
    it('allows the request through and keys per action + user', async () => {
      const { redis, chain } = makeRedis({ execResolves: execResultWithCount(1) });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-1')).resolves.toBeUndefined();
      expect(chain.incr).toHaveBeenCalledWith('2fa:attempt:verify:user-1');
      expect(chain.pexpire).toHaveBeenCalledWith(
        '2fa:attempt:verify:user-1',
        TWO_FACTOR_ATTEMPT_WINDOW_MS,
        'NX',
      );
    });

    it('keys verify/activate/disable independently for the same user', async () => {
      const { redis, chain } = makeRedis({ execResolves: execResultWithCount(1) });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await limiter.assertAllowed('verify', 'user-3');
      await limiter.assertAllowed('activate', 'user-3');
      await limiter.assertAllowed('disable', 'user-3');

      expect(chain.incr).toHaveBeenNthCalledWith(1, '2fa:attempt:verify:user-3');
      expect(chain.incr).toHaveBeenNthCalledWith(2, '2fa:attempt:activate:user-3');
      expect(chain.incr).toHaveBeenNthCalledWith(3, '2fa:attempt:disable:user-3');
    });

    it('allows up to and including the limit', async () => {
      const { redis } = makeRedis({ execResolves: execResultWithCount(TWO_FACTOR_ATTEMPT_LIMIT) });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-1')).resolves.toBeUndefined();
    });
  });

  describe('over limit (deny stands)', () => {
    it('throws a 429 ProblemException with a Retry-After hint once the limit is exceeded', async () => {
      const { redis } = makeRedis({
        execResolves: execResultWithCount(TWO_FACTOR_ATTEMPT_LIMIT + 1),
        pttlResolves: 17_000,
      });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('activate', 'user-2')).rejects.toMatchObject({
        problem: { status: 429 },
        retryAfterSeconds: 17,
      });
    });

    it('rejects with a ProblemException instance (not a generic Error)', async () => {
      const { redis } = makeRedis({
        execResolves: execResultWithCount(TWO_FACTOR_ATTEMPT_LIMIT + 1),
      });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-4')).rejects.toBeInstanceOf(
        ProblemException,
      );
    });

    it('still denies with a full-window retry hint when the PTTL lookup fails', async () => {
      const { redis } = makeRedis({
        execResolves: execResultWithCount(TWO_FACTOR_ATTEMPT_LIMIT + 1),
        pttlRejects: new Error('ECONNRESET'),
      });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-5')).rejects.toMatchObject({
        problem: { status: 429 },
        retryAfterSeconds: Math.ceil(TWO_FACTOR_ATTEMPT_WINDOW_MS / 1000),
      });
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('Redis failure (fail CLOSED — the security-critical difference from the ingest limiter)', () => {
    it('denies (throws a 503) when the MULTI transaction rejects', async () => {
      const { redis } = makeRedis({ execRejects: new Error('ECONNREFUSED') });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-6')).rejects.toMatchObject({
        problem: { status: 503 },
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it('denies when the connection is down entirely (multi() throws synchronously)', async () => {
      const redis = {
        multi: jest.fn(() => {
          throw new Error('connection is closed');
        }),
        pttl: jest.fn(),
      } as unknown as Redis;
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-7')).rejects.toBeInstanceOf(
        ProblemException,
      );
      await expect(limiter.assertAllowed('verify', 'user-7')).rejects.toMatchObject({
        problem: { status: 503 },
      });
    });

    it('denies when exec() resolves to null', async () => {
      const { redis } = makeRedis({ execResolves: null });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-8')).rejects.toMatchObject({
        problem: { status: 503 },
      });
    });

    it('denies when the incr entry carries a per-command error', async () => {
      const { redis } = makeRedis({
        execResolves: [
          [new Error('WRONGTYPE Operation against a key holding the wrong kind of value'), null],
          [null, 1],
        ],
      });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-9')).rejects.toMatchObject({
        problem: { status: 503 },
      });
    });

    it('denies when the incr reply is not a number (malformed results)', async () => {
      const { redis } = makeRedis({
        execResolves: [
          [null, 'not-a-count'],
          [null, 1],
        ],
      });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-10')).rejects.toMatchObject({
        problem: { status: 503 },
      });
    });

    it('gives a clear "authentication temporarily unavailable" title/detail on the 503', async () => {
      const { redis } = makeRedis({ execRejects: new Error('ECONNREFUSED') });
      const limiter = new TwoFactorAttemptLimiter(redis);

      await expect(limiter.assertAllowed('verify', 'user-11')).rejects.toMatchObject({
        problem: {
          status: 503,
          title: 'Service Unavailable',
          detail: expect.stringMatching(/temporarily unavailable/i),
        },
      });
    });
  });
});
