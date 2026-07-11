import type { PrismaService } from '../prisma/prisma.service';
import { OrgsService } from './orgs.service';

interface FakePrisma {
  organization: { create: jest.Mock; update: jest.Mock };
  membership: { create: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
}

interface FakePrismaOverrides {
  organization?: Partial<FakePrisma['organization']>;
  membership?: Partial<FakePrisma['membership']>;
}

function makePrisma(overrides: FakePrismaOverrides = {}): FakePrisma {
  const base = {
    organization: {
      create: jest.fn(),
      update: jest.fn(),
    },
    membership: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as FakePrisma;
  if (overrides.organization) Object.assign(base.organization, overrides.organization);
  if (overrides.membership) Object.assign(base.membership, overrides.membership);
  base.$transaction = jest.fn(async (fn: (tx: FakePrisma) => unknown) => fn(base));
  return base;
}

function makeService(prisma: unknown) {
  return new OrgsService(prisma as unknown as PrismaService);
}

describe('OrgsService', () => {
  describe('create', () => {
    it('makes the creator the org owner, in one transaction', async () => {
      const prisma = makePrisma();
      prisma.organization.create.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      const service = makeService(prisma);

      const created = await service.create('user-1', 'Acme');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.organization.create).toHaveBeenCalledWith({ data: { name: 'Acme' } });
      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', orgId: 'org-1', role: 'owner' },
      });
      expect(created).toEqual({ id: 'org-1', name: 'Acme', role: 'owner' });
    });
  });

  describe('listForUser', () => {
    it('maps memberships -> { id, name, role }', async () => {
      const prisma = makePrisma({
        membership: {
          findMany: jest.fn().mockResolvedValue([
            { userId: 'user-1', orgId: 'org-1', role: 'admin', org: { id: 'org-1', name: 'Acme' } },
            {
              userId: 'user-1',
              orgId: 'org-2',
              role: 'viewer',
              org: { id: 'org-2', name: 'Beta' },
            },
          ]),
        },
      });
      const service = makeService(prisma);

      const orgs = await service.listForUser('user-1');

      expect(prisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
      expect(orgs).toEqual([
        { id: 'org-1', name: 'Acme', role: 'admin' },
        { id: 'org-2', name: 'Beta', role: 'viewer' },
      ]);
    });

    it('returns an empty list for a user with no memberships', async () => {
      const service = makeService(makePrisma());
      await expect(service.listForUser('lonely')).resolves.toEqual([]);
    });
  });

  describe('rename', () => {
    it('updates and returns the new name', async () => {
      const prisma = makePrisma();
      prisma.organization.update.mockResolvedValue({ id: 'org-1', name: 'New Name' });
      const service = makeService(prisma);

      const result = await service.rename('org-1', 'New Name');

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'New Name' },
      });
      expect(result).toEqual({ id: 'org-1', name: 'New Name' });
    });
  });
});
