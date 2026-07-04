import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { ProblemException } from '../common/problem-details';
import { REDIS } from '../redis/redis.module';

/** Contracts §11: "max ~10/5min" per user for 2FA code-guessing endpoints. */
export const TWO_FACTOR_ATTEMPT_LIMIT = 10;
export const TWO_FACTOR_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

export type TwoFactorAction = 'verify' | 'activate' | 'disable';

function attemptKey(action: TwoFactorAction, userId: string): string {
  return `2fa:attempt:${action}:${userId}`;
}

/**
 * Per-user brute-force throttle for the endpoints that check a TOTP/recovery code
 * (`/2fa/verify`, `/2fa/activate`, and — defense in depth, beyond the letter of §11 —
 * `/2fa/disable`, which also accepts a guessable code).
 *
 * FAILURE POLICY — deliberately the OPPOSITE of `SlidingWindowRateLimiter`
 * (../ingestion/rate-limiter.ts):
 *   - Ingestion's limiter fails OPEN on a Redis error: for analytics ingestion, an availability
 *     outage is the lesser harm, so an unreachable store lets traffic through unthrottled.
 *   - THIS limiter fails CLOSED: the thing being rate-limited is TOTP/recovery-code guessing, so
 *     the harm is inverted — failing open on a Redis outage would hand an attacker unlimited
 *     brute-force attempts for as long as the outage lasts. ANY Redis error here (the INCR/EXPIRE
 *     transaction throwing, resolving null, or yielding a malformed/errored reply) therefore DENIES
 *     the attempt with a 503, rather than allowing it through like the ingestion limiter would.
 *
 * Implementation deliberately does NOT reuse `SlidingWindowRateLimiter`: it keeps its own simple
 * per-user-per-action Redis counter (INCR, with a window-length PEXPIRE set only the first time
 * the key is created via `NX`) rather than a sliding-window ZSET. A fixed window is an acceptable
 * trade for a low-volume, security-critical counter, and keeping the counter local means the
 * "any error = deny" policy lives in exactly one place instead of being layered on top of shared,
 * fail-open infrastructure that was designed for a different threat model.
 */
@Injectable()
export class TwoFactorAttemptLimiter {
  private readonly logger = new Logger(TwoFactorAttemptLimiter.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async assertAllowed(action: TwoFactorAction, userId: string): Promise<void> {
    const key = attemptKey(action, userId);
    let count: number;
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .pexpire(key, TWO_FACTOR_ATTEMPT_WINDOW_MS, 'NX')
        .exec();
      // A null exec result, a per-command error entry, or a non-numeric incr reply all mean no
      // count was established — unlike the ingest limiter, that is NOT treated as "allow"; see
      // the fail-closed policy note above.
      const incrEntry = results?.[0];
      const incrReply = incrEntry && incrEntry[0] === null ? incrEntry[1] : undefined;
      if (typeof incrReply !== 'number') {
        throw new Error(
          `2fa attempt counter transaction yielded no usable count (exec=${results === null ? 'null' : 'malformed'})`,
        );
      }
      count = incrReply;
    } catch (err) {
      this.logger.error(
        `2FA attempt limiter store unavailable; failing CLOSED (denying) for key ${key}: ${String(err)}`,
      );
      throw new ProblemException({
        status: 503,
        title: 'Service Unavailable',
        detail: 'Authentication is temporarily unavailable; please try again shortly',
      });
    }

    if (count > TWO_FACTOR_ATTEMPT_LIMIT) {
      // The deny decision stands even if the best-effort Retry-After lookup below fails; fall
      // back to a full-window hint rather than ever downgrading a deny to an allow.
      let retryAfterSeconds = Math.max(1, Math.ceil(TWO_FACTOR_ATTEMPT_WINDOW_MS / 1000));
      try {
        const ttlMs = await this.redis.pttl(key);
        if (ttlMs > 0) {
          retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
        }
      } catch (err) {
        this.logger.warn(
          `2FA attempt limiter retry-after lookup failed for key ${key}; using full-window hint: ${String(err)}`,
        );
      }
      throw new ProblemException({
        status: 429,
        title: 'Too Many Requests',
        detail: `Too many 2FA attempts; try again in ${retryAfterSeconds}s`,
        retryAfterSeconds,
      });
    }
  }
}
