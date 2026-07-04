import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { MembersService } from './members.service';

const ORG_ID = 'org-1';
const USER_1 = '018f6b2e-0000-7000-8000-000000000001';
const USER_2 = '018f6b2e-0000-7000-8000-000000000002';
const UNKNOWN_USER = '018f6b2e-0000-7000-8000-0000000000ff';

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

/** A `PrismaClientKnownRequestError` shaped like the real Postgres serialization failure
 *  (SQLSTATE 40001) that Postgres raises under SERIALIZABLE isolation when it detects a
 *  write-skew conflict between two concurrent transactions. */
function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: '6.8.0' },
  );
}

describe('MembersService', () => {
  describe('list', () => {
    it('maps memberships -> { user, role }', async () => {
      const prisma = makePrisma({
        membership: {
          findMany: jest.fn().mockResolvedValue([
            {
              userId: USER_1,
              orgId: ORG_ID,
              role: 'admin',
              user: { id: USER_1, email: 'a@b.com', name: 'A' },
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
        { user: { id: USER_1, email: 'a@b.com', name: 'A' }, role: 'admin' },
      ]);
    });
  });

  describe('changeRole', () => {
    it('changes the role of a non-admin member', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: USER_2, orgId: ORG_ID, role: 'viewer' }),
          count: jest.fn(),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      const result = await service.changeRole(ORG_ID, USER_2, 'analyst');

      expect(prisma.membership.count).not.toHaveBeenCalled(); // only checked for admin targets
      expect(prisma.membership.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: USER_2, orgId: ORG_ID } },
        data: { role: 'analyst' },
      });
      expect(result).toEqual({ user_id: USER_2, role: 'analyst' });
    });

    it('allows an admin -> admin "change" even when they are the only admin (no-op role)', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest.fn().mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(1),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, USER_1, 'admin')).resolves.toEqual({
        user_id: USER_1,
        role: 'admin',
      });
    });

    it('409s when demoting the last admin — SECURITY-CRITICAL', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest.fn().mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(1),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, USER_1, 'viewer')).rejects.toMatchObject({
        problem: { status: 409 },
      });
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('allows demoting an admin when there is another admin', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest.fn().mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(2),
          update: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, USER_1, 'analyst')).resolves.toEqual({
        user_id: USER_1,
        role: 'analyst',
      });
    });

    it('404s when the target user is not a member of the org', async () => {
      const service = makeService(makePrisma());
      await expect(service.changeRole(ORG_ID, UNKNOWN_USER, 'admin')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s for a malformed (non-UUID-shaped) userId without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, 'not-a-uuid', 'admin')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    });

    it(
      'is atomic under a Postgres write-skew conflict — SECURITY-CRITICAL: retries once on a ' +
        'serialization failure and then succeeds',
      async () => {
        const prisma = makePrisma({
          membership: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
            count: jest.fn().mockResolvedValue(2), // another admin exists by the time we retry
            update: jest.fn(),
          },
        });
        let attempt = 0;
        prisma.$transaction = jest.fn(async (fn: (tx: FakePrisma) => unknown) => {
          attempt += 1;
          if (attempt === 1) throw serializationFailure();
          return fn(prisma);
        });
        const service = makeService(prisma);

        await expect(service.changeRole(ORG_ID, USER_1, 'viewer')).resolves.toEqual({
          user_id: USER_1,
          role: 'viewer',
        });
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(
          (prisma.$transaction as jest.Mock).mock.calls.every(
            ([, options]) =>
              options?.isolationLevel === Prisma.TransactionIsolationLevel.Serializable,
          ),
        ).toBe(true);
      },
    );

    it('does not retry more than once — a SECOND serialization failure propagates', async () => {
      const prisma = makePrisma();
      prisma.$transaction = jest.fn(async () => {
        throw serializationFailure();
      });
      const service = makeService(prisma);

      await expect(service.changeRole(ORG_ID, USER_1, 'viewer')).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('remove', () => {
    it('removes a non-admin member', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: USER_2, orgId: ORG_ID, role: 'viewer' }),
          count: jest.fn(),
          delete: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await service.remove(ORG_ID, USER_2);

      expect(prisma.membership.count).not.toHaveBeenCalled();
      expect(prisma.membership.delete).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: USER_2, orgId: ORG_ID } },
      });
    });

    it('409s when removing the last admin — SECURITY-CRITICAL', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest.fn().mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(1),
          delete: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.remove(ORG_ID, USER_1)).rejects.toMatchObject({
        problem: { status: 409 },
      });
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });

    it('allows removing an admin when there is another admin', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest.fn().mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
          count: jest.fn().mockResolvedValue(2),
          delete: jest.fn(),
        },
      });
      const service = makeService(prisma);

      await expect(service.remove(ORG_ID, USER_1)).resolves.toBeUndefined();
      expect(prisma.membership.delete).toHaveBeenCalled();
    });

    it('404s when the target user is not a member of the org', async () => {
      const service = makeService(makePrisma());
      await expect(service.remove(ORG_ID, UNKNOWN_USER)).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s for a malformed (non-UUID-shaped) userId without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);

      await expect(service.remove(ORG_ID, 'not-a-uuid')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    });

    it(
      'is atomic under a Postgres write-skew conflict — SECURITY-CRITICAL: retries once on a ' +
        'serialization failure and then succeeds',
      async () => {
        const prisma = makePrisma({
          membership: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: USER_1, orgId: ORG_ID, role: 'admin' }),
            count: jest.fn().mockResolvedValue(2),
            delete: jest.fn(),
          },
        });
        let attempt = 0;
        prisma.$transaction = jest.fn(async (fn: (tx: FakePrisma) => unknown) => {
          attempt += 1;
          if (attempt === 1) throw serializationFailure();
          return fn(prisma);
        });
        const service = makeService(prisma);

        await expect(service.remove(ORG_ID, USER_1)).resolves.toBeUndefined();
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(prisma.membership.delete).toHaveBeenCalled();
      },
    );
  });
});
