import type { ExecutionContext } from '@nestjs/common';
import { ErasureCapabilityGuard } from './erasure-capability.guard';
import type { ProblemException } from '../common/problem-details';
import type { ResolvedServerKey } from './server-key.guard';

const ctxFor = (serverKey?: ResolvedServerKey): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ serverKey }) }) }) as unknown as ExecutionContext;

function rejectionOf(serverKey?: ResolvedServerKey): ProblemException {
  try {
    new ErasureCapabilityGuard().canActivate(ctxFor(serverKey));
  } catch (err) {
    return err as ProblemException;
  }
  throw new Error('expected the guard to reject');
}

describe('ErasureCapabilityGuard', () => {
  it('allows a key carrying the capability', () => {
    const guard = new ErasureCapabilityGuard();
    expect(guard.canActivate(ctxFor({ projectId: 'p1', canErase: true }))).toBe(true);
  });

  it('rejects a key without the capability with 403, not 401', () => {
    const problem = rejectionOf({ projectId: 'p1', canErase: false }).problem;
    expect(problem.status).toBe(403);
    expect(problem.detail).toContain('can_erase');
  });

  it('rejects an unauthenticated request with 401', () => {
    expect(rejectionOf(undefined).problem.status).toBe(401);
  });
});
