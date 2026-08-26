import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ErasureService } from './erasure.service';

const PROJECT_ID = '3f0a4b7c-0000-7000-8000-000000000001';

function makeMocks(relatedIds: Array<{ id: string }> = []) {
  const clickhouse = {
    query: jest.fn().mockResolvedValue(relatedIds),
    deleteUserData: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    subscriptionState: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    revenueCatWebhookEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const service = new ErasureService(
    clickhouse as unknown as ClickHouseService,
    prisma as unknown as PrismaService,
  );
  return { clickhouse, prisma, service };
}

describe('ErasureService', () => {
  it('expands the id set through identity_mappings and deletes across every store (happy path)', async () => {
    const { clickhouse, prisma, service } = makeMocks([{ id: 'anon-1' }, { id: 'anon-2' }]);

    const result = await service.erase(PROJECT_ID, 'firebase-uid');

    expect(clickhouse.query).toHaveBeenCalledWith(expect.stringContaining('identity_mappings'), {
      projectId: PROJECT_ID,
      distinctId: 'firebase-uid',
    });
    expect(clickhouse.deleteUserData).toHaveBeenCalledWith(PROJECT_ID, [
      'firebase-uid',
      'anon-1',
      'anon-2',
    ]);
    expect(prisma.subscriptionState.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        OR: [
          { distinctId: { in: ['firebase-uid', 'anon-1', 'anon-2'] } },
          { rcAppUserId: { in: ['firebase-uid', 'anon-1', 'anon-2'] } },
        ],
      },
    });
    expect(prisma.revenueCatWebhookEvent.deleteMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, rcAppUserId: { in: ['firebase-uid', 'anon-1', 'anon-2'] } },
    });
    expect(result).toEqual({
      ids: ['firebase-uid', 'anon-1', 'anon-2'],
      subscriptionStates: 2,
      revenueCatWebhookEvents: 3,
    });
  });

  it('deduplicates and drops empty related ids (edge case)', async () => {
    const { clickhouse, service } = makeMocks([
      { id: 'firebase-uid' },
      { id: '' },
      { id: 'anon-1' },
      { id: 'anon-1' },
    ]);

    const result = await service.erase(PROJECT_ID, 'firebase-uid');

    expect(clickhouse.deleteUserData).toHaveBeenCalledWith(PROJECT_ID, ['firebase-uid', 'anon-1']);
    expect(result.ids).toEqual(['firebase-uid', 'anon-1']);
  });

  it('still erases the requested id when no identity mappings exist (edge case)', async () => {
    const { clickhouse, service } = makeMocks([]);

    const result = await service.erase(PROJECT_ID, 'firebase-uid');

    expect(clickhouse.deleteUserData).toHaveBeenCalledWith(PROJECT_ID, ['firebase-uid']);
    expect(result.ids).toEqual(['firebase-uid']);
  });

  it('propagates a ClickHouse failure without touching Postgres (error path)', async () => {
    const { clickhouse, prisma, service } = makeMocks([]);
    clickhouse.deleteUserData.mockRejectedValue(new Error('ch down'));

    await expect(service.erase(PROJECT_ID, 'firebase-uid')).rejects.toThrow('ch down');
    expect(prisma.subscriptionState.deleteMany).not.toHaveBeenCalled();
    expect(prisma.revenueCatWebhookEvent.deleteMany).not.toHaveBeenCalled();
  });
});
