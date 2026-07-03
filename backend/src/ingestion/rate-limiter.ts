import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Distributed sliding-window rate limiter (contracts §4: 1000 req/min per token).
 * State lives in a Redis ZSET (`rl:<key>`, score = ms timestamp), so any number of
 * stateless Cloud Run instances share one window. One MULTI keeps it near-atomic;
 * an over-limit probe removes its own member so denied requests do not consume quota.
 *
 * Failure policy:
 * - Fail-open ONLY when no allow/deny decision could be made — the MULTI/EXEC that
 *   determines the count fails, returns null, or yields a malformed/errored zcard
 *   entry. The request is then allowed with a warning (availability over throttling,
 *   consistent with SdkTokenGuard's degrade-to-direct-lookup behavior).
 * - Once EXEC has resolved and count > limit, the DENY decision stands even if the
 *   post-decision cleanup (zrem) or Retry-After computation (zrange) fails: those are
 *   wrapped separately and fall back to a full-window retry hint.
 */
@Injectable()
export class SlidingWindowRateLimiter {
  private readonly logger = new Logger(SlidingWindowRateLimiter.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const member = `${now}-${randomUUID()}`;
    const redisKey = `rl:${key}`;

    let count: number;
    try {
      const results = await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, now - windowMs)
        .zadd(redisKey, now, member)
        .zcard(redisKey)
        .pexpire(redisKey, windowMs)
        .exec();
      // A null exec result, a per-command error entry, or a non-numeric zcard reply all
      // mean no count was established — treat as "no decision".
      const zcardEntry = results?.[2];
      const zcardReply = zcardEntry && zcardEntry[0] === null ? zcardEntry[1] : undefined;
      if (typeof zcardReply !== 'number') {
        throw new Error(
          `rate limiter transaction yielded no usable count (exec=${results === null ? 'null' : 'malformed'})`,
        );
      }
      count = zcardReply;
    } catch (err) {
      // No allow/deny decision could be made — fail open (availability over throttling,
      // consistent with SdkTokenGuard's degrade behavior). Do not throttle traffic just
      // because the rate-limit store is down.
      this.logger.warn(
        `rate limiter store unavailable; failing open for key ${key}: ${String(err)}`,
      );
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }

    if (count > limit) {
      // The deny decision exists; it must stand even if the cleanup/retry-hint reads fail.
      let retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
      try {
        await this.redis.zrem(redisKey, member);
        const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
        const oldestScore = oldest.length === 2 ? Number(oldest[1]) : now;
        retryAfterSeconds = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));
      } catch (err) {
        this.logger.warn(
          `rate limiter post-decision cleanup failed for key ${key}; denying with full-window retry hint: ${String(err)}`,
        );
      }
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  }
}
