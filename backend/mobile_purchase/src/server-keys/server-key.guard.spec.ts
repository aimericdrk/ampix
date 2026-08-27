import type { ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { ServerKeyGuard } from './server-key.guard';

const KEY = `mp_srv_${'a1b2c3d4'.repeat(4)}`;
const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';

type Row = { projectId: string; canErase: boolean; revokedAt: Date | null } | null;

function makeGuard(row: Row) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const prisma = { serverKey: { findUnique } } as unknown as PrismaService;
  return { guard: new ServerKeyGuard(prisma), findUnique };
}

function ctxFor(headers: Record<string, string>) {
  const req: Record<string, unknown> = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('ServerKeyGuard', () => {
  it('resolves the project and capability from a live key', async () => {
    const { guard } = makeGuard({ projectId: PROJECT_ID, canErase: true, revokedAt: null });
    const { ctx, req } = ctxFor({ authorization: `Bearer ${KEY}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.serverKey).toEqual({ projectId: PROJECT_ID, canErase: true });
  });

  it('rejects a missing Authorization header', async () => {
    const { guard, findUnique } = makeGuard(null);
    await expect(guard.canActivate(ctxFor({}).ctx)).rejects.toThrow(ProblemException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  // A public SDK key is `mp_pub_…`: presenting one here never reaches the database — the two
  // credentials cannot be used interchangeably by accident. It is also the predictable mistake (an
  // app already holds that key), so the rejection names the credential to use instead.
  it('rejects a public SDK key without touching the database, and says what to use', async () => {
    const { guard, findUnique } = makeGuard(null);
    const { ctx } = ctxFor({ authorization: `Bearer mp_pub_${'0'.repeat(32)}` });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      problem: { status: 401, detail: expect.stringContaining('mp_srv_') },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown key', async () => {
    const { guard } = makeGuard(null);
    const { ctx } = ctxFor({ authorization: `Bearer ${KEY}` });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ problem: { status: 401 } });
  });

  it('rejects a revoked key', async () => {
    const { guard } = makeGuard({ projectId: PROJECT_ID, canErase: true, revokedAt: new Date() });
    const { ctx } = ctxFor({ authorization: `Bearer ${KEY}` });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ problem: { status: 401 } });
  });
});
