import { BadRequestException } from '@nestjs/common';
import { RcWebhookProcessor } from './rc-webhook.processor';

const INTEGRATION = { id: 'int-1', projectId: 'pid-1', sandboxMode: false };
const NOW = 1_750_000_002_000;
const EVENT = {
  id: 'evt-1', type: 'INITIAL_PURCHASE', app_user_id: 'rc-user-1', product_id: 'pro_monthly',
  period_type: 'NORMAL', purchased_at_ms: 1_750_000_000_000, expiration_at_ms: 1_752_592_000_000,
  event_timestamp_ms: 1_750_000_001_000, store: 'APP_STORE', environment: 'PRODUCTION',
  price: 9.99, currency: 'USD',
};
const BODY = { api_version: '1.0', event: EVENT };

function buildMocks() {
  const journalRows: any[] = [];
  const stateRows = new Map<string, any>();
  const prisma = {
    revenueCatWebhookEvent: {
      create: jest.fn(async ({ data }: any) => {
        if (journalRows.some((r) => r.rcEventId === data.rcEventId)) {
          const err: any = new Error('unique'); err.code = 'P2002'; throw err;
        }
        const row = { id: `j-${journalRows.length}`, ...data }; journalRows.push(row); return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = journalRows.find((r) => r.id === where.id); Object.assign(row, data); return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        journalRows.filter((r) => where.status.in.includes(r.status) &&
          (where.rcAppUserId === undefined || r.rcAppUserId === where.rcAppUserId))),
      count: jest.fn(async ({ where }: any) =>
        journalRows.filter((r) => where.status.in.includes(r.status) &&
          (where.rcAppUserId === undefined || r.rcAppUserId === where.rcAppUserId)).length),
    },
    subscriptionState: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.projectId_rcAppUserId.projectId}:${where.projectId_rcAppUserId.rcAppUserId}`;
        const existing = stateRows.get(key);
        const next = existing
          ? { ...existing, ...update, totalSpentCents: existing.totalSpentCents + (update.totalSpentCents?.increment ?? 0) }
          : { ...create };
        stateRows.set(key, next); return next;
      }),
    },
    revenueCatIntegration: { update: jest.fn(async () => ({})) },
  } as any;
  const clickhouse = { insertEvents: jest.fn(async () => undefined) } as any;
  const profileWriter = { apply: jest.fn(async () => undefined) } as any;
  const identity = { resolveDistinctId: jest.fn(async () => 'distinct-1') } as any;
  return { prisma, clickhouse, profileWriter, identity, journalRows, stateRows };
}

describe('RcWebhookProcessor.process', () => {
  it('journals, writes the CH event on the resolved id, upserts state, writes profile props, marks processed', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('processed');
    expect(m.clickhouse.insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event: '$rc_initial_purchase', distinct_id: 'distinct-1', insert_id: 'evt-1' }),
    ]);
    const state = m.stateRows.get('pid-1:rc-user-1');
    expect(state).toMatchObject({ status: 'active', distinctId: 'distinct-1' });
    expect(m.profileWriter.apply).toHaveBeenCalledWith('pid-1',
      [expect.objectContaining({ distinct_id: 'distinct-1', op: 'set' })], NOW);
    expect(m.prisma.revenueCatIntegration.update).toHaveBeenCalled();
  });

  it('is idempotent on the RC event id (duplicate → no second CH insert)', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.clickhouse.insertEvents).toHaveBeenCalledTimes(1);
  });

  it('journals unresolvable identities as unlinked and skips CH/profile writes', async () => {
    const m = buildMocks();
    m.identity.resolveDistinctId.mockResolvedValue(null);
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('unlinked');
    expect(m.clickhouse.insertEvents).not.toHaveBeenCalled();
    // state still tracked, without a distinct id:
    expect(m.stateRows.get('pid-1:rc-user-1')).toMatchObject({ distinctId: null, status: 'active' });
  });

  it('skips SANDBOX events when sandboxMode is off, processes them when on', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, { event: { ...EVENT, id: 'evt-sb', environment: 'SANDBOX' } }, NOW);
    expect(m.journalRows[0].status).toBe('skipped');
    await p.process({ ...INTEGRATION, sandboxMode: true },
      { event: { ...EVENT, id: 'evt-sb2', environment: 'SANDBOX' } }, NOW);
    expect(m.journalRows[1].status).toBe('processed');
  });

  it('journals TEST and unknown types as processed without a CH event', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, { event: { ...EVENT, id: 'evt-t', type: 'TEST' } }, NOW);
    await p.process(INTEGRATION, { event: { ...EVENT, id: 'evt-u', type: 'FUTURE_TYPE' } }, NOW);
    expect(m.journalRows.map((r) => r.status)).toEqual(['processed', 'processed']);
    expect(m.clickhouse.insertEvents).not.toHaveBeenCalled();
  });

  it('journals processing failures as failed with the error message', async () => {
    const m = buildMocks();
    m.clickhouse.insertEvents.mockRejectedValue(new Error('ch down'));
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW); // must NOT throw — RC gets its 200
    expect(m.journalRows[0]).toMatchObject({ status: 'failed', error: 'ch down' });
  });

  it('rejects an unparseable payload with 400', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await expect(p.process(INTEGRATION, { nope: true }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RcWebhookProcessor.replayUnlinked', () => {
  it('re-processes unlinked rows once the identity resolves', async () => {
    const m = buildMocks();
    m.identity.resolveDistinctId.mockResolvedValueOnce(null).mockResolvedValue('distinct-1');
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('unlinked');
    const result = await p.replayUnlinked('pid-1', 'rc-user-1', NOW);
    expect(result).toEqual({ replayed: 1, remaining: 0 });
    expect(m.journalRows[0].status).toBe('processed');
    expect(m.clickhouse.insertEvents).toHaveBeenCalledTimes(1);
  });

  it('also replays failed rows, and remaining reflects the true post-loop count', async () => {
    const m = buildMocks();
    m.clickhouse.insertEvents.mockRejectedValueOnce(new Error('ch down'));
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('failed');
    const result = await p.replayUnlinked('pid-1', 'rc-user-1', NOW);
    expect(result).toEqual({ replayed: 1, remaining: 0 });
    expect(m.journalRows[0].status).toBe('processed');
  });
});

describe('RcWebhookProcessor state regression', () => {
  it('a later CANCELLATION patches only cancelledAt, retaining fields set by the INITIAL_PURCHASE', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);

    const cancellation = {
      id: 'evt-cancel', type: 'CANCELLATION', app_user_id: 'rc-user-1',
      event_timestamp_ms: NOW + 1_000, environment: 'PRODUCTION', price: null,
    };
    await p.process(INTEGRATION, { event: cancellation }, NOW + 1_000);

    const state = m.stateRows.get('pid-1:rc-user-1');
    expect(state).toMatchObject({
      status: 'active', // CANCELLATION does not change status
      productId: 'pro_monthly', // retained from INITIAL_PURCHASE, not clobbered
      store: 'APP_STORE', // retained from INITIAL_PURCHASE, not clobbered
      totalSpentCents: 999, // unchanged: CANCELLATION's addSpendCents is 0
      firstPurchaseAt: new Date(EVENT.purchased_at_ms), // set-once, untouched by later events
    });
    expect(state.cancelledAt).toEqual(new Date(cancellation.event_timestamp_ms));
  });
});
