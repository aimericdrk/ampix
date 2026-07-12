import { RcAdminService } from './rc-admin.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';
const ROW = {
  id: 'int-1', projectId: PID, webhookSecret: 'rcwh_abc', apiKey: 'sk_live_secret1234',
  rcProjectId: 'proj123', sandboxMode: false, lastWebhookAt: null, backfillStatus: null,
  connectedAt: new Date(0),
};

function build(overrides: { integration?: unknown } = {}) {
  const prisma = {
    revenueCatIntegration: {
      findUnique: jest.fn(async () => overrides.integration ?? null),
      upsert: jest.fn(async ({ create, update }: any) => ({ ...ROW, ...create, ...update })),
      delete: jest.fn(async () => ROW),
    },
    revenueCatWebhookEvent: {
      groupBy: jest.fn(async () => [{ status: 'processed', _count: { _all: 3 } }]),
      findMany: jest.fn(async () => []),
    },
    subscriptionState: { findFirst: jest.fn(async () => null) },
  } as any;
  const projects = { assertMembership: jest.fn(async () => undefined) } as any;
  const processor = { replayUnlinked: jest.fn(async () => ({ replayed: 1, remaining: 0 })) } as any;
  return { prisma, projects, processor, svc: new RcAdminService(prisma, projects, processor) };
}

describe('RcAdminService', () => {
  it('getStatus returns connected=false shell when no row exists', async () => {
    const { svc } = build();
    const s = await svc.getStatus(PID);
    expect(s).toMatchObject({ connected: false, webhook_path: `/webhooks/revenuecat/${PID}` });
  });

  it('getStatus masks the api key to its last 4 chars and returns counts', async () => {
    const { svc } = build({ integration: ROW });
    const s = await svc.getStatus(PID);
    expect(s.api_key_masked).toBe('…1234');
    expect(s.webhook_secret).toBe('rcwh_abc');
    expect(s.counts).toEqual({ processed: 3, failed: 0, unlinked: 0, skipped: 0 });
  });

  it('upsert generates a rcwh_ webhook secret on create and never regenerates it on update', async () => {
    const { svc, prisma } = build();
    await svc.upsert(PID, { api_key: 'k', rc_project_id: 'p', sandbox_mode: true });
    const args = prisma.revenueCatIntegration.upsert.mock.calls[0][0];
    expect(args.create.webhookSecret).toMatch(/^rcwh_[0-9a-f]{48}$/);
    expect(args.update.webhookSecret).toBeUndefined();
  });

  it('getUserSubscription asserts membership and returns null when unknown', async () => {
    const { svc, projects } = build();
    await expect(svc.getUserSubscription('u1', PID, 'ghost')).resolves.toEqual({ subscription: null });
    expect(projects.assertMembership).toHaveBeenCalledWith('u1', PID);
  });

  it('getUserSubscription builds rc_customer_url when rc_project_id is set', async () => {
    const { svc, prisma } = build({ integration: ROW });
    prisma.subscriptionState.findFirst.mockResolvedValue({
      status: 'active', productId: 'pro', store: 'APP_STORE', periodType: 'NORMAL',
      totalSpentCents: 999, mrrCents: 999, currency: 'USD', firstPurchaseAt: new Date(0),
      expiresAt: null, cancelledAt: null, rcAppUserId: 'rc user/1',
    });
    const r = await svc.getUserSubscription('u1', PID, 'distinct-1');
    expect(r.subscription!.rc_customer_url).toBe(
      'https://app.revenuecat.com/customers/proj123/rc%20user%2F1',
    );
  });
});
