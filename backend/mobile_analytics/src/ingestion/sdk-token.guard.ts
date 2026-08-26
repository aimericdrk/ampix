import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DEFAULT_INGEST_SOURCE, SDK_TOKEN_REGEX, type IngestSource } from '@myampix/contracts';
import { REDIS } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import type { IngestRequest } from './ingest-auth';

/**
 * `v2` because the cached value gained `source`: a v1 entry written by a pod running the previous
 * image would deserialize into `{ source: undefined }` and mislabel events for up to the TTL. A new
 * key space means old and new pods simply miss each other's entries during a rollout.
 */
export function sdkTokenCacheKey(token: string): string {
  return `sdk_token:v2:${token}`;
}

/** Revocation staleness bound: a revoked token stays valid at most this long unless the
 *  revoke path DELs the cache key (projects module, phase 2). */
export const SDK_TOKEN_CACHE_TTL_SECONDS = 60;

interface CachedLookup {
  projectId: string | null;
  source?: IngestSource;
}

/**
 * Authenticates /ingest requests: `Authorization: Bearer mam_<32hex>` (contracts §4).
 * Hot path: Redis cache (60 s, negative results cached too) in front of Postgres sdk_tokens.
 */
@Injectable()
export class SdkTokenGuard implements CanActivate {
  private readonly logger = new Logger(SdkTokenGuard.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) { }

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

    const cached = await this.readCache(sdkTokenCacheKey(token));
    if (cached !== null) {
      if (!cached.projectId) throw this.unauthorized();
      req.ingestAuth = {
        projectId: cached.projectId,
        token,
        source: cached.source ?? DEFAULT_INGEST_SOURCE,
      };
      return true;
    }

    const row = await this.prisma.sdkToken.findUnique({ where: { token } });
    const live = row !== null && row.revokedAt === null ? row : null;
    const projectId = live?.projectId ?? null;
    // Cached alongside projectId rather than re-read per batch: source is immutable for the life of
    // a token, so a cache hit can never carry a stale one.
    const source = (live?.source as IngestSource | undefined) ?? DEFAULT_INGEST_SOURCE;
    await this.writeCache(sdkTokenCacheKey(token), { projectId, source });
    if (!projectId) throw this.unauthorized();
    req.ingestAuth = { projectId, token, source };
    return true;
  }

  /** Redis unavailability or a corrupt entry must not break ingestion: treat as a cache miss. */
  private async readCache(key: string): Promise<CachedLookup | null> {
    try {
      const cached = await this.redis.get(key);
      return cached === null ? null : (JSON.parse(cached) as CachedLookup);
    } catch (err) {
      // cache unavailable — degrade to direct lookup
      this.logger.warn(`sdk token cache read failed; degrading to direct lookup: ${String(err)}`);
      return null;
    }
  }

  /** Auth outcome is already decided by Postgres at this point: swallow cache-write failures. */
  private async writeCache(key: string, lookup: CachedLookup): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(lookup), 'EX', SDK_TOKEN_CACHE_TTL_SECONDS);
    } catch (err) {
      // cache unavailable — continue without caching
      this.logger.warn(`sdk token cache write failed; continuing without cache: ${String(err)}`);
    }
  }

  private unauthorized(): ProblemException {
    return new ProblemException({
      status: 401,
      title: 'Unauthorized',
      detail: 'Missing, invalid, or revoked SDK token',
    });
  }
}
