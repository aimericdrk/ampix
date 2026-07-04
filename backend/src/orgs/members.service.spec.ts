import type { PrismaService } from '../prisma/prisma.service';
import { MembersService } from './members.service';

const ORG_ID = 'org-1';

interface FakePrisma {
  membership: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrisma(
  overrides: { membership?: Partial<FakePrisma['membership']> } = {},
): FakePrisma {
  const base = {
    membership: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as FakePrisma;
  if (overrides.membership) Object.assign(base.membership, overrides.membership);
  base.$transaction = jest.fn(async (fn: (tx: FakePrisma) => unknown) => fn(base));
  return base;
}

function makeService(prisma: unknown) {
  return new MembersService(prisma as unknown as PrismaService);
}

describe('MembersService', () => {
  describe('list', () => {
    it('maps memberships -> { user, role }', async () => {
      const prisma = makePrisma({
        membership: {
          findMany: jest.fn().mockResolvedValue([
            {
              userId: 'user-1',
              orgId: ORG_ID,
              role: 'admin',
              user: { id: 'user-1', email: 'a@b.com', name: 'A' },
            },
          ]),
        },
      });
      const service = makeService(prisma);

      const members = await service.list(ORG_ID);

      expect(prisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: ORG_ID } }),
      );
      expect(members).toEqual([
        { user: { id: 'user-1', email: 'a@b.com', name: 'A' }, role: 'admin' },
      ]);
    });
  });

  describe('changeRole', () => {
    it('changes the role of a non-admin member', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-2', orgId: ORG_ID, role: 'viewer' }),
          count: jest.fn(),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      const result = await service.changeRole(ORG_ID, 'user-2', 'analyst');

      expect(prisma.membership.count).not.toHaveBeenCalled(); // only checked for admin targets
      expect(prisma.membership.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'user-2', orgId: ORG_ID } },
        data: { role: 'analyst' },
      });
      expect(result).toEqual({ user_id: 'user-2', role: 'analyst' });
    });

    it('allows an admin -> admin "change" even when they are the only admin (no-op role)', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(1),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, 'user-1', 'admin')).resolves.toEqual({
        user_id: 'user-1',
        role: 'admin',
      });
    });

    it('409s when demoting the last admin — SECURITY-CRITICAL', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(1),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, 'user-1', 'viewer')).rejects.toMatchObject({
        problem: { status: 409 },
      });
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('allows demoting an admin when there is another admin', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(2),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, 'user-1', 'analyst')).resolves.toEqual({
        user_id: 'user-1',
        role: 'analyst',
      });
    });

    it('404s when the target user is not a member of the org', async () => {
      const service = makeService(makePrisma());
      await expect(service.changeRole(ORG_ID, 'nobody', 'admin')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });
  });

  describe('remove', () => {
    it('removes a non-admin member', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-2', orgId: ORG_ID, role: 'viewer' }),
          count: jest.fn(),
          delete: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await service.remove(ORG_ID, 'user-2');

      expect(prisma.membership.count).not.toHaveBeenCalled();
      expect(prisma.membership.delete).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'user-2', orgId: ORG_ID } },
      });
    });

    it('409s when removing the last admin — SECURITY-CRITICAL', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(1),
          delete: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.remove(ORG_ID, 'user-1')).rejects.toMatchObject({
        problem: { status: 409 },
      });
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });

    it('allows removing an admin when there is another admin', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(2),
          delete: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.remove(ORG_ID, 'user-1')).resolves.toBeUndefined();
      expect(prisma.membership.delete).toHaveBeenCalled();
    });

    it('404s when the target user is not a member of the org', async () => {
      const service = makeService(makePrisma());
      await expect(service.remove(ORG_ID, 'nobody')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });
  });
});
