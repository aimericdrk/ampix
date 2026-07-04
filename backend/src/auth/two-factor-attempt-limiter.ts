import { Injectable } from '@nestjs/common';
import { ProblemException } from '../common/problem-details';
import { SlidingWindowRateLimiter } from '../ingestion/rate-limiter';

/** Contracts §11: "max ~10/5min" per user for 2FA code-guessing endpoints. */
export const TWO_FACTOR_ATTEMPT_LIMIT = 10;
export const TWO_FACTOR_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

export type TwoFactorAction = 'verify' | 'activate' | 'disable';

/**
 * Per-user brute-force throttle for the endpoints that check a TOTP/recovery code
 * (`/2fa/verify`, `/2fa/activate`, and — defense in depth, beyond the letter of §11 —
 * `/2fa/disable`, which also accepts a guessable code). Reuses the ingestion module's
 * Redis sliding-window limiter keyed per user instead of per SDK token.
 */
@Injectable()
export class TwoFactorAttemptLimiter {
  constructor(private readonly limiter: SlidingWindowRateLimiter) {}

  async assertAllowed(action: TwoFactorAction, userId: string): Promise<void> {
    const result = await this.limiter.consume(
      `2fa:${action}:${userId}`,
      TWO_FACTOR_ATTEMPT_LIMIT,
      TWO_FACTOR_ATTEMPT_WINDOW_MS,
    );
    if (!result.allowed) {
      throw new ProblemException({
        status: 429,
        title: 'Too Many Requests',
        detail: `Too many 2FA attempts; try again in ${result.retryAfterSeconds}s`,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
}
