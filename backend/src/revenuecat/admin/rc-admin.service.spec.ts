import { RcAdminService } from './rc-admin.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';
const ROW = {
  id: 'int-1', projectId: PID, webhookSecret: 'rcwh_abc', apiKey: 'sk_live_secret1234',
  rcProjectId: 'proj123', sandboxMode: false, lastWebhookAt: null, backfillStatus: null,
  connectedAt: new Date(0),
};

function build(overrides: { integration?: unknown; existingCohortNames?: string[] } = {}) {
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
    cohort: {
      findMany: jest.fn(async () => (overrides.existingCohortNames ?? []).map((name) => ({ name }))),
    },
    subscriptionState: { findFirst: jest.fn(async () => null) },
  } as any;
  const projects = { assertMembership: jest.fn(async () => undefined) } as any;
  const processor = { replayUnlinked: jest.fn(async () => ({ replayed: 1, remaining: 0 })) } as any;
  const backfill = { run: jest.fn(async () => undefined), fireAndForget: jest.fn() } as any;
  const cohorts = { create: jest.fn(async () => undefined) } as any;
  return {
    prisma,
    projects,
    processor,
    backfill,
    cohorts,
    svc: new RcAdminService(prisma, projects, processor, backfill, cohorts),
  };
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
    await svc.upsert(PID, { api_key: 'k', rc_project_id: 'p', sandbox_mode: true }, 'user-1');
    const args = prisma.revenueCatIntegration.upsert.mock.calls[0][0];
    expect(args.create.webhookSecret).toMatch(/^rcwh_[0-9a-f]{48}$/);
    expect(args.update.webhookSecret).toBeUndefined();
  });

  it('upsert triggers backfill on the create path when an api key is provided', async () => {
    const { svc, backfill } = build();
    await svc.upsert(PID, { api_key: 'k', rc_project_id: 'p', sandbox_mode: true }, 'user-1');
    expect(backfill.fireAndForget).toHaveBeenCalledWith(PID);
  });

  it('upsert does not trigger backfill on the update path (row already existed)', async () => {
    const { svc, backfill } = build({ integration: ROW });
    await svc.upsert(PID, { api_key: 'k2', rc_project_id: 'p', sandbox_mode: true }, 'user-1');
    expect(backfill.fireAndForget).not.toHaveBeenCalled();
  });

  it('upsert does not trigger backfill on create when no api key is provided', async () => {
    const { svc, backfill } = build();
    await svc.upsert(PID, { rc_project_id: 'p', sandbox_mode: true }, 'user-1');
    expect(backfill.fireAndForget).not.toHaveBeenCalled();
  });

  it('creates the four RC cohorts on first connect, skipping existing names', async () => {
    const { svc, cohorts } = build();
    await svc.upsert(PID, { api_key: 'k' }, 'user-1');
    const names = cohorts.create.mock.calls.map((c: any) => c[2].name);
    expect(names).toEqual([
      'RC: Active subscribers', 'RC: In trial', 'RC: Churned', 'RC: Billing issue',
    ]);
    expect(cohorts.create.mock.calls[0][2].definition).toEqual({
      match: 'all',
      conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value: 'active' }],
    });
  });

  it('does not create cohorts when the integration already existed', async () => {
    const { svc, cohorts } = build({ integration: ROW });
    await svc.upsert(PID, { sandbox_mode: true }, 'user-1');
    expect(cohorts.create).not.toHaveBeenCalled();
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
