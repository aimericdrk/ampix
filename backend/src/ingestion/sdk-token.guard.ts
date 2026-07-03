import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { SDK_TOKEN_REGEX } from '@myampmix/contracts';
import { REDIS } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import type { IngestRequest } from './ingest-auth';

export function sdkTokenCacheKey(token: string): string {
  return `sdk_token:${token}`;
}

/** Revocation staleness bound: a revoked token stays valid at most this long unless the
 *  revoke path DELs the cache key (projects module, phase 2). */
export const SDK_TOKEN_CACHE_TTL_SECONDS = 60;

interface CachedLookup {
  projectId: string | null;
}

/**
 * Authenticates /ingest requests: `Authorization: Bearer mam_<32hex>` (contracts §4).
 * Hot path: Redis cache (60 s, negative results cached too) in front of Postgres sdk_tokens.
 */
@Injectable()
export class SdkTokenGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;
    if (!token || !SDK_TOKEN_REGEX.test(token)) {
      throw this.unauthorized();
    }

    const cached = await this.redis.get(sdkTokenCacheKey(token));
    if (cached !== null) {
      const lookup = JSON.parse(cached) as CachedLookup;
      if (!lookup.projectId) throw this.unauthorized();
      req.ingestAuth = { projectId: lookup.projectId, token };
      return true;
    }

    const row = await this.prisma.sdkToken.findUnique({ where: { token } });
    const projectId = row !== null && row.revokedAt === null ? row.projectId : null;
    await this.redis.set(
      sdkTokenCacheKey(token),
      JSON.stringify({ projectId }),
      'EX',
      SDK_TOKEN_CACHE_TTL_SECONDS,
    );
    if (!projectId) throw this.unauthorized();
    req.ingestAuth = { projectId, token };
    return true;
  }

  private unauthorized(): ProblemException {
    return new ProblemException({
      status: 401,
      title: 'Unauthorized',
      detail: 'Missing, invalid, or revoked SDK token',
    });
  }
}
