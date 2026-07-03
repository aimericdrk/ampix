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
 * Fail-open: if Redis is unavailable, the request is allowed through (availability
 * over throttling — consistent with SdkTokenGuard's degrade-to-direct-lookup behavior)
 * and a warning is logged.
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

    try {
      const results = await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, now - windowMs)
        .zadd(redisKey, now, member)
        .zcard(redisKey)
        .pexpire(redisKey, windowMs)
        .exec();
      if (!results) {
        throw new Error('rate limiter transaction failed');
      }
      const count = results[2][1] as number;

      if (count > limit) {
        await this.redis.zrem(redisKey, member);
        const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
        const oldestScore = oldest.length === 2 ? Number(oldest[1]) : now;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }
      return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
    } catch (err) {
      // Redis unavailable — fail open (availability over throttling, consistent with
      // SdkTokenGuard's degrade behavior). Do not throttle traffic just because the
      // rate-limit store is down.
      this.logger.warn(
        `rate limiter store unavailable; failing open for key ${key}: ${String(err)}`,
      );
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }
}
