import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { RcWebhookGuard } from './rc-webhook.guard';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';
const ROW = { id: 'int-1', projectId: PID, sandboxMode: false, webhookSecret: 'rcwh_secret_value_123456' };

function ctx(params: Record<string, string>, authorization?: string) {
  const req: any = { params, headers: authorization ? { authorization } : {} };
  return {
    req,
    context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
  };
}

describe('RcWebhookGuard', () => {
  const prisma = { revenueCatIntegration: { findUnique: jest.fn() } } as any;
  const guard = new RcWebhookGuard(prisma);
  beforeEach(() => prisma.revenueCatIntegration.findUnique.mockReset());

  it('404s a non-uuid projectId without touching the db', async () => {
    const { context } = ctx({ projectId: 'nope' }, ROW.webhookSecret);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.revenueCatIntegration.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the project has no integration', async () => {
    prisma.revenueCatIntegration.findUnique.mockResolvedValue(null);
    const { context } = ctx({ projectId: PID }, ROW.webhookSecret);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('401s a wrong or missing Authorization header', async () => {
    prisma.revenueCatIntegration.findUnique.mockResolvedValue(ROW);
    await expect(guard.canActivate(ctx({ projectId: PID }, 'wrong').context))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx({ projectId: PID }).context))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the exact secret (with or without a Bearer prefix) and attaches rcIntegration', async () => {
    prisma.revenueCatIntegration.findUnique.mockResolvedValue(ROW);
    const a = ctx({ projectId: PID }, ROW.webhookSecret);
    await expect(guard.canActivate(a.context)).resolves.toBe(true);
    expect(a.req.rcIntegration).toMatchObject({ id: 'int-1', projectId: PID });
    const b = ctx({ projectId: PID }, `Bearer ${ROW.webhookSecret}`);
    await expect(guard.canActivate(b.context)).resolves.toBe(true);
  });
});
