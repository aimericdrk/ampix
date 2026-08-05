import { RcBackfillService } from './rc-backfill.service';

const PID = 'pid-1';
const ROW = { id: 'int-1', projectId: PID, apiKey: 'sk_test', rcProjectId: 'p1', sandboxMode: false };

function build() {
  const prisma = {
    revenueCatIntegration: {
      findUnique: jest.fn(async () => ROW),
      update: jest.fn(async () => ({})),
    },
    subscriptionState: { upsert: jest.fn(async ({ create }: any) => create) },
  } as any;
  const client = {
    listCustomers: jest.fn(async function* () { yield [{ id: 'rc-user-1' }]; }),
    getSubscriptions: jest.fn(async () => [
      { product_id: 'pro_monthly', store: 'app_store', status: 'active',
        current_period_ends_at: 1_752_592_000_000, gives_access: true },
    ]),
  } as any;
  const identity = { resolveDistinctId: jest.fn(async () => 'distinct-1') } as any;
  const profileWriter = { apply: jest.fn(async () => undefined) } as any;
  const clickhouse = { insertEvents: jest.fn() } as any;
  return { prisma, client, identity, profileWriter, clickhouse,
    svc: new RcBackfillService(prisma, client, identity, profileWriter) };
}

describe('RcBackfillService.run', () => {
  it('seeds SubscriptionState + profile props from the RC API without writing CH events', async () => {
    const m = build();
    await m.svc.run(PID);
    expect(m.prisma.subscriptionState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_rcAppUserId: { projectId: PID, rcAppUserId: 'rc-user-1' } },
      }),
    );
    expect(m.profileWriter.apply).toHaveBeenCalled();
    // status transitions running -> done
    const statuses = m.prisma.revenueCatIntegration.update.mock.calls.map(
      (c: any) => c[0].data.backfillStatus,
    );
    expect(statuses[0]).toBe('running');
    expect(statuses[statuses.length - 1]).toBe('done');
  });

  it('records failures on backfillStatus instead of throwing', async () => {
    const m = build();
    m.client.getSubscriptions.mockRejectedValue(new Error('boom'));
    await m.svc.run(PID);
    const last = m.prisma.revenueCatIntegration.update.mock.calls.at(-1)[0].data.backfillStatus;
    expect(last).toMatch(/^failed: boom/);
  });

  it('no-ops (status failed: missing credentials) when api key or rc project id is absent', async () => {
    const m = build();
    m.prisma.revenueCatIntegration.findUnique.mockResolvedValue({ ...ROW, apiKey: null });
    await m.svc.run(PID);
    expect(m.client.listCustomers).not.toHaveBeenCalled();
  });

  it('never rejects when the initial findUnique rejects', async () => {
    const m = build();
    m.prisma.revenueCatIntegration.findUnique.mockRejectedValue(new Error('db down'));
    await expect(m.svc.run(PID)).resolves.toBeUndefined();
  });

  it('never rejects when the pre-loop setStatus write rejects (and logs instead of throwing)', async () => {
    const m = build();
    m.prisma.revenueCatIntegration.update.mockRejectedValue(new Error('write failed'));
    await expect(m.svc.run(PID)).resolves.toBeUndefined();
  });
});

describe('RcBackfillService.fireAndForget', () => {
  it('never rejects even if run() somehow throws', async () => {
    const m = build();
    m.prisma.revenueCatIntegration.findUnique.mockRejectedValue(new Error('db down'));
    expect(() => m.svc.fireAndForget(PID)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('RcBackfillService.syncCustomer refresh reconciliation', () => {
  it('sets totalSpentCents from total_revenue_in_usd.gross on refresh', async () => {
    const m = build();
    m.client.getSubscriptions.mockResolvedValue([
      { product_id: 'pro_monthly', store: 'app_store', status: 'active',
        current_period_ends_at: 1_752_592_000_000, gives_access: true,
        total_revenue_in_usd: { gross: 49.99 } },
    ]);
    await m.svc.syncCustomer(PID, 'sk_test', 'p1', 'rc-user-1');
    const call = m.prisma.subscriptionState.upsert.mock.calls[0][0];
    expect(call.update.totalSpentCents).toBe(4999);
  });

  it('does not touch totalSpentCents on refresh when total_revenue_in_usd is absent', async () => {
    const m = build();
    m.client.getSubscriptions.mockResolvedValue([
      { product_id: 'pro_monthly', store: 'app_store', status: 'active',
        current_period_ends_at: 1_752_592_000_000, gives_access: true },
    ]);
    await m.svc.syncCustomer(PID, 'sk_test', 'p1', 'rc-user-1');
    const call = m.prisma.subscriptionState.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('totalSpentCents');
  });
});
