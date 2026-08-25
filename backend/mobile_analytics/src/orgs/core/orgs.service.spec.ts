import type { ClickHouseService } from '../../clickhouse/clickhouse.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { OrgsService } from './orgs.service';

interface FakePrisma {
  organization: { create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  membership: { create: jest.Mock; findMany: jest.Mock };
  project: { findMany: jest.Mock };
  $transaction: jest.Mock;
}

interface FakePrismaOverrides {
  organization?: Partial<FakePrisma['organization']>;
  membership?: Partial<FakePrisma['membership']>;
  project?: Partial<FakePrisma['project']>;
}

function makePrisma(overrides: FakePrismaOverrides = {}): FakePrisma {
  const base = {
    organization: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    membership: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    project: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as FakePrisma;
  if (overrides.organization) Object.assign(base.organization, overrides.organization);
  if (overrides.membership) Object.assign(base.membership, overrides.membership);
  if (overrides.project) Object.assign(base.project, overrides.project);
  base.$transaction = jest.fn(async (fn: (tx: FakePrisma) => unknown) => fn(base));
  return base;
}

function makeClickHouse() {
  return { deleteProjectData: jest.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: unknown, clickhouse: unknown = makeClickHouse()) {
  return new OrgsService(
    prisma as unknown as PrismaService,
    clickhouse as unknown as ClickHouseService,
  );
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

  describe('remove', () => {
    it("purges every project's ClickHouse data, then deletes the org", async () => {
      const prisma = makePrisma({
        project: {
          findMany: jest.fn().mockResolvedValue([{ id: 'proj-1' }, { id: 'proj-2' }]),
        },
      });
      const clickhouse = makeClickHouse();
      const service = makeService(prisma, clickhouse);

      await service.remove('org-1');

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        select: { id: true },
      });
      expect(clickhouse.deleteProjectData).toHaveBeenCalledTimes(2);
      expect(clickhouse.deleteProjectData).toHaveBeenCalledWith('proj-1');
      expect(clickhouse.deleteProjectData).toHaveBeenCalledWith('proj-2');
      expect(prisma.organization.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    });

    it('records an attributable audit line before destroying anything', async () => {
      const prisma = makePrisma({
        project: { findMany: jest.fn().mockResolvedValue([{ id: 'proj-1' }]) },
      });
      const service = makeService(prisma);
      const logged: string[] = [];
      jest
        .spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
        .mockImplementation((m: string) => {
          logged.push(m);
        });

      await service.remove('org-1', 'user-9');

      // Irreversible + unattributable after the fact, so the actor and the doomed project ids must
      // be on record BEFORE the delete, not merely implied by the org's later absence.
      expect(logged[0]).toContain('org.delete');
      expect(logged[0]).toContain('orgId=org-1');
      expect(logged[0]).toContain('actor=user-9');
      expect(logged[0]).toContain('proj-1');
    });

    it('deletes an org with no projects without touching ClickHouse', async () => {
      const prisma = makePrisma();
      const clickhouse = makeClickHouse();
      const service = makeService(prisma, clickhouse);

      await service.remove('org-1');

      expect(clickhouse.deleteProjectData).not.toHaveBeenCalled();
      expect(prisma.organization.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    });

    // The two stores cannot share a transaction, so ordering IS the safety property: a ClickHouse
    // failure must leave the org intact and retryable rather than half-deleted.
    it('leaves the org intact when the ClickHouse purge fails', async () => {
      const prisma = makePrisma({
        project: { findMany: jest.fn().mockResolvedValue([{ id: 'proj-1' }]) },
      });
      const clickhouse = {
        deleteProjectData: jest.fn().mockRejectedValue(new Error('clickhouse down')),
      };
      const service = makeService(prisma, clickhouse);

      await expect(service.remove('org-1')).rejects.toThrow('clickhouse down');
      expect(prisma.organization.delete).not.toHaveBeenCalled();
    });
  });
});
