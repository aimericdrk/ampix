import type { ClickHouseService } from '../../clickhouse/clickhouse.service';
import type { ErasureService } from '../../erasure/erasure.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProjectsService } from '../../projects/core/projects.service';
import { UserAdminService } from './user-admin.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

function make(options: { canonicalId?: string } = {}) {
  const clickhouse = {
    query: jest
      .fn()
      .mockResolvedValue(options.canonicalId ? [{ canonical_id: options.canonicalId }] : []),
  };
  const prisma = {
    hiddenUser: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const projects = { assertMembership: jest.fn().mockResolvedValue(undefined) };
  const erasure = {
    erase: jest.fn().mockResolvedValue({
      ids: ['u1', 'anon-u1'],
      subscriptionStates: 1,
      revenueCatWebhookEvents: 2,
    }),
  };
  const service = new UserAdminService(
    clickhouse as unknown as ClickHouseService,
    prisma as unknown as PrismaService,
    projects as unknown as ProjectsService,
    erasure as unknown as ErasureService,
  );
  return { service, clickhouse, prisma, projects, erasure };
}

describe('UserAdminService', () => {
  describe('hideUser', () => {
    it('asserts membership before doing anything', async () => {
      const { service, projects } = make();
      await service.hideUser(USER, PROJECT, 'u1');
      expect(projects.assertMembership).toHaveBeenCalledWith(USER, PROJECT);
    });

    it('hides the CANONICAL id when handed one of the user\'s anon ids', async () => {
      const { service, prisma } = make({ canonicalId: 'u1' });
      const result = await service.hideUser(USER, PROJECT, 'anon-u1');
      expect(result.distinct_id).toBe('u1');
      expect(prisma.hiddenUser.create).toHaveBeenCalledWith({
        data: { projectId: PROJECT, distinctId: 'u1', hiddenById: USER },
      });
    });

    it('falls back to the requested id when it is already canonical', async () => {
      const { service, prisma } = make();
      const result = await service.hideUser(USER, PROJECT, 'u1');
      expect(result.distinct_id).toBe('u1');
      expect(prisma.hiddenUser.create).toHaveBeenCalledWith({
        data: { projectId: PROJECT, distinctId: 'u1', hiddenById: USER },
      });
    });

    it('is idempotent — re-hiding an already-hidden user is a success, not a 409', async () => {
      const { service, prisma } = make();
      prisma.hiddenUser.findUnique.mockResolvedValue({ id: 'row-1' });
      const result = await service.hideUser(USER, PROJECT, 'u1');
      expect(result.distinct_id).toBe('u1');
      expect(prisma.hiddenUser.create).not.toHaveBeenCalled();
    });

    it('lets an idempotent re-hide through even at the ceiling', async () => {
      const { service, prisma } = make();
      prisma.hiddenUser.findUnique.mockResolvedValue({ id: 'row-1' });
      prisma.hiddenUser.count.mockResolvedValue(1000);
      await expect(service.hideUser(USER, PROJECT, 'u1')).resolves.toEqual({ distinct_id: 'u1' });
    });

    it('refuses a NEW hide past the per-project ceiling with a 409', async () => {
      const { service, prisma } = make();
      prisma.hiddenUser.count.mockResolvedValue(1000);
      await expect(service.hideUser(USER, PROJECT, 'u1')).rejects.toMatchObject({
        problem: { status: 409 },
      });
      expect(prisma.hiddenUser.create).not.toHaveBeenCalled();
    });

    it('rejects an out-of-bounds distinct id with a 400', async () => {
      const { service, clickhouse } = make();
      await expect(service.hideUser(USER, PROJECT, '')).rejects.toMatchObject({
        problem: { status: 400 },
      });
      await expect(service.hideUser(USER, PROJECT, 'x'.repeat(256))).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('unhideUser', () => {
    it('deletes by BOTH the canonical and the requested id', async () => {
      // A row written before the anon id was linked is keyed on the anon id; resolving alone
      // would no longer reach it.
      const { service, prisma } = make({ canonicalId: 'u1' });
      await service.unhideUser(USER, PROJECT, 'anon-u1');
      expect(prisma.hiddenUser.deleteMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT, distinctId: { in: ['u1', 'anon-u1'] } },
      });
    });

    it('does not duplicate the id when it is already canonical', async () => {
      const { service, prisma } = make();
      await service.unhideUser(USER, PROJECT, 'u1');
      expect(prisma.hiddenUser.deleteMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT, distinctId: { in: ['u1'] } },
      });
    });

    it('succeeds for a user who was never hidden', async () => {
      const { service } = make();
      await expect(service.unhideUser(USER, PROJECT, 'u1')).resolves.toBeUndefined();
    });
  });

  describe('eraseUser', () => {
    it('delegates to the SAME ErasureService the GDPR ingest route uses', async () => {
      const { service, erasure } = make();
      const result = await service.eraseUser(USER, PROJECT, 'u1');
      expect(erasure.erase).toHaveBeenCalledWith(PROJECT, 'u1');
      expect(result).toEqual({
        ids: ['u1', 'anon-u1'],
        subscriptionStates: 1,
        revenueCatWebhookEvents: 2,
      });
    });

    it('drops any hidden-user rows for every erased id', async () => {
      const { service, prisma } = make();
      await service.eraseUser(USER, PROJECT, 'u1');
      expect(prisma.hiddenUser.deleteMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT, distinctId: { in: ['u1', 'anon-u1'] } },
      });
    });

    it('validates the id before erasing anything', async () => {
      const { service, erasure } = make();
      await expect(service.eraseUser(USER, PROJECT, '')).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(erasure.erase).not.toHaveBeenCalled();
    });
  });

  describe('hiddenIds / listHiddenUsers', () => {
    it('returns a plain array of ids for the read path to bind', async () => {
      const { service, prisma } = make();
      prisma.hiddenUser.findMany.mockResolvedValue([{ distinctId: 'u1' }, { distinctId: 'u2' }]);
      expect(await service.hiddenIds(PROJECT)).toEqual(['u1', 'u2']);
    });

    it('lists who is hidden, by whom and when', async () => {
      const { service, prisma } = make();
      prisma.hiddenUser.findMany.mockResolvedValue([
        {
          distinctId: 'u1',
          hiddenAt: new Date('2026-08-01T10:00:00.000Z'),
          hiddenBy: { name: 'Ada' },
        },
      ]);
      expect(await service.listHiddenUsers(USER, PROJECT)).toEqual({
        users: [{ distinct_id: 'u1', hidden_at: '2026-08-01T10:00:00.000Z', hidden_by: 'Ada' }],
      });
    });

    it('reports a deleted dashboard account as a null hider rather than crashing', async () => {
      const { service, prisma } = make();
      prisma.hiddenUser.findMany.mockResolvedValue([
        { distinctId: 'u1', hiddenAt: new Date('2026-08-01T10:00:00.000Z'), hiddenBy: null },
      ]);
      const result = await service.listHiddenUsers(USER, PROJECT);
      expect(result.users[0].hidden_by).toBeNull();
    });
  });
});
