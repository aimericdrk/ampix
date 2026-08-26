import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { ErasureKeyGuard } from './erasure-key.guard';

const KEY = 'super-secret-erasure-key';

function ctxFor(headers: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as unknown as ExecutionContext;
}

describe('ErasureKeyGuard', () => {
  it('allows the request when X-Erasure-Key matches the configured key (happy path)', () => {
    const guard = new ErasureKeyGuard({ erasureApiKey: KEY } as AppConfig);
    expect(guard.canActivate(ctxFor({ 'x-erasure-key': KEY }))).toBe(true);
  });

  it('throws a 403 problem when ERASURE_API_KEY is not configured — fail closed (authorization)', () => {
    const guard = new ErasureKeyGuard({} as AppConfig);
    expect(() => guard.canActivate(ctxFor({ 'x-erasure-key': KEY }))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 403 }) }),
    );
  });

  it('throws a 401 problem when the header is missing (authorization)', () => {
    const guard = new ErasureKeyGuard({ erasureApiKey: KEY } as AppConfig);
    expect(() => guard.canActivate(ctxFor({}))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 401 }) }),
    );
  });

  it('throws a 401 problem when the header does not match, including a different length (authorization)', () => {
    const guard = new ErasureKeyGuard({ erasureApiKey: KEY } as AppConfig);
    for (const wrong of ['wrong', `${KEY}x`, KEY.slice(0, -1)]) {
      expect(() => guard.canActivate(ctxFor({ 'x-erasure-key': wrong }))).toThrow(
        expect.objectContaining({ problem: expect.objectContaining({ status: 401 }) }),
      );
    }
  });

  it('rejects a non-string header value (edge case)', () => {
    const guard = new ErasureKeyGuard({ erasureApiKey: KEY } as AppConfig);
    expect(() => guard.canActivate(ctxFor({ 'x-erasure-key': [KEY, KEY] }))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 401 }) }),
    );
  });
});
