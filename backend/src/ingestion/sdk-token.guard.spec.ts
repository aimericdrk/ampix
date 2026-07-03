import { Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { SdkTokenGuard, sdkTokenCacheKey } from './sdk-token.guard';

const TOKEN = 'mam_' + 'a1b2c3d4'.repeat(4);
const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';

class FakeRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _ex: string, ttl: number): Promise<'OK'> {
    this.store.set(key, value);
    this.ttls.set(key, ttl);
    return 'OK';
  }
}

function makeGuard(opts: {
  cached?: string;
  dbRow?: { projectId: string; revokedAt: Date | null } | null;
  redisGetError?: Error;
  redisSetError?: Error;
}) {
  const redis = new FakeRedis();
  if (opts.cached !== undefined) redis.store.set(sdkTokenCacheKey(TOKEN), opts.cached);
  const getSpy = jest.spyOn(redis, 'get');
  const setSpy = jest.spyOn(redis, 'set');
  if (opts.redisGetError) getSpy.mockRejectedValue(opts.redisGetError);
  if (opts.redisSetError) setSpy.mockRejectedValue(opts.redisSetError);
  const findUnique = jest.fn().mockResolvedValue(opts.dbRow ?? null);
  const prisma = { sdkToken: { findUnique } } as unknown as PrismaService;
  const guard = new SdkTokenGuard(redis as unknown as Redis, prisma);
  return { guard, redis, findUnique, getSpy, setSpy };
}

function ctxFor(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('SdkTokenGuard', () => {
  it('rejects a missing Authorization header with a 401 problem', async () => {
    const { guard } = makeGuard({});
    const { ctx } = ctxFor({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
  });

  it('rejects a malformed token without touching redis or postgres', async () => {
    const { guard, findUnique, getSpy } = makeGuard({});
    const { ctx } = ctxFor({ authorization: 'Bearer not-a-token' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ problem: { status: 401 } });
    expect(getSpy).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('serves a cached valid token without a postgres lookup', async () => {
    const { guard, findUnique } = makeGuard({ cached: JSON.stringify({ projectId: PROJECT_ID }) });
    const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a cached-negative token without a postgres lookup', async () => {
    const { guard, findUnique } = makeGuard({ cached: JSON.stringify({ projectId: null }) });
    const { ctx } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('looks up postgres on cache miss and caches the positive result for 60s', async () => {
    const { guard, redis, findUnique } = makeGuard({
      dbRow: { projectId: PROJECT_ID, revokedAt: null },
    });
    const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
    expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
    expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(
      JSON.stringify({ projectId: PROJECT_ID }),
    );
    expect(redis.ttls.get(sdkTokenCacheKey(TOKEN))).toBe(60);
  });

  it('rejects and caches-negative a revoked token', async () => {
    const { guard, redis } = makeGuard({ dbRow: { projectId: PROJECT_ID, revokedAt: new Date() } });
    const { ctx } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
    expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(JSON.stringify({ projectId: null }));
  });

  it('rejects and caches-negative an unknown token', async () => {
    const { guard, redis } = makeGuard({ dbRow: null });
    const { ctx } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
    expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(JSON.stringify({ projectId: null }));
  });

  describe('redis degradation', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('degrades to a direct postgres lookup when the cache read fails', async () => {
      const { guard, findUnique } = makeGuard({
        dbRow: { projectId: PROJECT_ID, revokedAt: null },
        redisGetError: new Error('connection refused'),
      });
      const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
      expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
      expect(warnSpy).toHaveBeenCalled();
    });

    it('still authenticates when the cache write fails after a postgres hit', async () => {
      const { guard, findUnique } = makeGuard({
        dbRow: { projectId: PROJECT_ID, revokedAt: null },
        redisSetError: new Error('connection refused'),
      });
      const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
      expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
      expect(warnSpy).toHaveBeenCalled();
    });

    it('treats a corrupt cache entry as a miss and consults postgres', async () => {
      const { guard, redis, findUnique } = makeGuard({
        cached: 'not-json{{{',
        dbRow: { projectId: PROJECT_ID, revokedAt: null },
      });
      const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
      expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
      expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(
        JSON.stringify({ projectId: PROJECT_ID }),
      );
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
