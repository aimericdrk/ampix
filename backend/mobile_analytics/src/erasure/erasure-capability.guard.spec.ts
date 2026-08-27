import { ExecutionContext } from '@nestjs/common';
import { ErasureCapabilityGuard } from './erasure-capability.guard';
import { ProblemException } from '../common/problem-details';
import type { IngestAuthContext } from '../ingestion/ingest-auth';

const ctxFor = (ingestAuth?: IngestAuthContext): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ ingestAuth }) }),
  }) as unknown as ExecutionContext;

const serverToken: IngestAuthContext = {
  projectId: 'p1',
  token: `mam_${'a'.repeat(32)}`,
  source: 'server',
  canErase: true,
};

/** Runs the guard and returns the problem it threw — fails the test if it allowed the request. */
function rejectionOf(auth?: IngestAuthContext): ProblemException {
  try {
    new ErasureCapabilityGuard().canActivate(ctxFor(auth));
  } catch (err) {
    return err as ProblemException;
  }
  throw new Error('expected the guard to reject');
}

describe('ErasureCapabilityGuard', () => {
  it('allows a server token carrying the capability', () => {
    expect(new ErasureCapabilityGuard().canActivate(ctxFor(serverToken))).toBe(true);
  });

  it('rejects a server token without the capability with 403', () => {
    const problem = rejectionOf({ ...serverToken, canErase: false }).problem;
    expect(problem.status).toBe(403);
    expect(problem.detail).toContain('can_erase');
  });

  // A client token can't hold the capability (request schema, service, and DB CHECK all refuse
  // the pair), but this guard is the last thing before an irreversible delete: it re-checks
  // rather than trusting that the three layers above it stayed correct.
  it('rejects a client token even when it somehow carries the capability', () => {
    const problem = rejectionOf({ ...serverToken, source: 'client' }).problem;
    expect(problem.status).toBe(403);
    expect(problem.detail).toContain('server token');
  });

  it('rejects an unauthenticated request with 401', () => {
    expect(rejectionOf(undefined).problem.status).toBe(401);
  });
});
