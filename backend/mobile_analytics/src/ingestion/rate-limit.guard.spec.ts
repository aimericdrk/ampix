import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { ProblemException } from '../common/problem-details';
import { IngestRateLimitGuard } from './rate-limit.guard';
import type { SlidingWindowRateLimiter } from './rate-limiter';

const TOKEN = 'mam_' + 'a'.repeat(32);
const config = { ingestRateLimitPerMin: 1000 } as AppConfig;

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('IngestRateLimitGuard', () => {
  it('allows requests under the limit, keyed per token', async () => {
    const consume = jest
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 999, retryAfterSeconds: 0 });
    const guard = new IngestRateLimitGuard(
      { consume } as unknown as SlidingWindowRateLimiter,
      config,
    );
    const ctx = ctxFor({ ingestAuth: { projectId: 'p1', token: TOKEN } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith(`ingest:${TOKEN}`, 1000);
  });

  it('throws a 429 problem carrying retryAfterSeconds when the limit is exceeded', async () => {
    const consume = jest
      .fn()
      .mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const guard = new IngestRateLimitGuard(
      { consume } as unknown as SlidingWindowRateLimiter,
      config,
    );
    const ctx = ctxFor({ ingestAuth: { projectId: 'p1', token: TOKEN } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      problem: { status: 429, title: 'Too Many Requests' },
      retryAfterSeconds: 42,
    });
  });

  it('throws a 401 problem when ingestAuth is missing (guard-order safety net)', async () => {
    const consume = jest.fn();
    const guard = new IngestRateLimitGuard(
      { consume } as unknown as SlidingWindowRateLimiter,
      config,
    );
    await expect(guard.canActivate(ctxFor({}))).rejects.toThrow(ProblemException);
    expect(consume).not.toHaveBeenCalled();
  });
});
