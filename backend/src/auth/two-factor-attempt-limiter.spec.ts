import { ProblemException } from '../common/problem-details';
import { SlidingWindowRateLimiter } from '../ingestion/rate-limiter';
import {
  TWO_FACTOR_ATTEMPT_LIMIT,
  TWO_FACTOR_ATTEMPT_WINDOW_MS,
  TwoFactorAttemptLimiter,
} from './two-factor-attempt-limiter';

describe('TwoFactorAttemptLimiter', () => {
  function makeLimiter(allowed: boolean, retryAfterSeconds = 42) {
    const consume = jest.fn().mockResolvedValue({ allowed, remaining: 0, retryAfterSeconds });
    const limiter = new TwoFactorAttemptLimiter({
      consume,
    } as unknown as SlidingWindowRateLimiter);
    return { limiter, consume };
  }

  it('allows the request through when under the limit', async () => {
    const { limiter, consume } = makeLimiter(true);
    await expect(limiter.assertAllowed('verify', 'user-1')).resolves.toBeUndefined();
    expect(consume).toHaveBeenCalledWith(
      '2fa:verify:user-1',
      TWO_FACTOR_ATTEMPT_LIMIT,
      TWO_FACTOR_ATTEMPT_WINDOW_MS,
    );
  });

  it('throws a 429 ProblemException with a Retry-After hint once the limit is hit', async () => {
    const { limiter } = makeLimiter(false, 17);
    await expect(limiter.assertAllowed('activate', 'user-2')).rejects.toMatchObject({
      problem: { status: 429 },
      retryAfterSeconds: 17,
    });
  });

  it('keys verify/activate/disable independently for the same user', async () => {
    const { limiter, consume } = makeLimiter(true);
    await limiter.assertAllowed('verify', 'user-3');
    await limiter.assertAllowed('activate', 'user-3');
    await limiter.assertAllowed('disable', 'user-3');
    expect(consume).toHaveBeenNthCalledWith(
      1,
      '2fa:verify:user-3',
      expect.any(Number),
      expect.any(Number),
    );
    expect(consume).toHaveBeenNthCalledWith(
      2,
      '2fa:activate:user-3',
      expect.any(Number),
      expect.any(Number),
    );
    expect(consume).toHaveBeenNthCalledWith(
      3,
      '2fa:disable:user-3',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('rejects with a ProblemException instance (not a generic Error)', async () => {
    const { limiter } = makeLimiter(false);
    await expect(limiter.assertAllowed('verify', 'user-4')).rejects.toBeInstanceOf(
      ProblemException,
    );
  });
});
