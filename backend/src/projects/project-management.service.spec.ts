import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { sdkTokenCacheKey } from '../ingestion/sdk-token.guard';
import { ProjectManagementService } from './project-management.service';

interface FakeProject {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
  createdById?: string;
}

interface FakeSdkToken {
  id: string;
  projectId: string;
  token: string;
  label: string;
  revokedAt: Date | null;
  createdAt: Date;
}

interface FakeProjectMembership {
  userId: string;
  projectId: string;
  role: string;
}

class FakePrisma {
  projects: FakeProject[] = [];
  sdkTokens: FakeSdkToken[] = [];
  projectMemberships: FakeProjectMembership[] = [];
  private nextProjectId = 0;
  private nextTokenId = 0;

  project = {
    create: async ({ data }: { data: Omit<FakeProject, 'id'> }) => {
      const row: FakeProject = { id: `project-${this.nextProjectId++}`, ...data };
      this.projects.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeProject> }) => {
      const project = this.projects.find((p) => p.id === where.id);
      if (!project) throw new Error('not found');
      Object.assign(project, data);
      return project;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.projects = this.projects.filter((p) => p.id !== where.id);
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.projects.find((p) => p.id === where.id) ?? null,
  };

  subscriptionState = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
  revenueCatWebhookEvent = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
  dashboard = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
  cohort = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
  savedReport = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };

  sdkToken = {
    create: async ({ data }: { data: { projectId: string; token: string; label: string } }) => {
      const row: FakeSdkToken = {
        id: `sdk-${this.nextTokenId++}`,
        revokedAt: null,
        createdAt: new Date(),
        ...data,
      };
      this.sdkTokens.push(row);
      return row;
    },
    findMany: async ({ where }: { where: { projectId: string; revokedAt: null } }) =>
      this.sdkTokens.filter((t) => t.projectId === where.projectId && t.revokedAt === null),
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.sdkTokens.find((t) => t.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeSdkToken> }) => {
      const token = this.sdkTokens.find((t) => t.id === where.id);
      if (!token) throw new Error('not found');
      Object.assign(token, data);
      return token;
    },
  };

  projectMembership = {
    create: async ({ data }: { data: FakeProjectMembership }) => {
      this.projectMemberships.push({ ...data });
      return data;
    },
  };

  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

function makeService(prisma: FakePrisma, redis?: Partial<Redis>) {
  const fakeRedis = { del: jest.fn().mockResolvedValue(1), ...redis };
  const clickhouse = { deleteProjectData: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new ProjectManagementService(
      prisma as unknown as PrismaService,
      fakeRedis as unknown as Redis,
      clickhouse as unknown as import('../clickhouse/clickhouse.service').ClickHouseService,
    ),
    redis: fakeRedis,
    clickhouse,
  };
}

describe('ProjectManagementService', () => {
  describe('createForOrg', () => {
    it('creates the project + an initial SdkToken, atomically', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);

      const created = await service.createForOrg('org-1', 'New App', 'user-1', 'Europe/Paris');

      expect(created).toMatchObject({ org_id: 'org-1', name: 'New App', timezone: 'Europe/Paris' });
      expect(created.ingest_token).toMatch(/^mam_[0-9a-f]{32}$/);
      expect(prisma.sdkTokens).toHaveLength(1);
      expect(prisma.sdkTokens[0]).toMatchObject({
        projectId: created.id,
        token: created.ingest_token,
      });
    });

    it('defaults timezone to UTC when omitted', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);
      const created = await service.createForOrg('org-1', 'New App', 'user-1');
      expect(created.timezone).toBe('UTC');
    });

    it('sets createdById to the creating user and grants them an owner ProjectMembership — otherwise the creator would be locked out under the per-project access model', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);

      const created = await service.createForOrg('org-1', 'New App', 'user-1');

      expect(prisma.projects[0].createdById).toBe('user-1');
      expect(prisma.projectMemberships).toEqual([
        { userId: 'user-1', projectId: created.id, role: 'owner' },
      ]);
    });
  });

  describe('update', () => {
    it('applies only the provided fields', async () => {
      const prisma = new FakePrisma();
      prisma.projects.push({ id: 'p1', orgId: 'org-1', name: 'Old', timezone: 'UTC' });
      const { service } = makeService(prisma);

      const updated = await service.update('p1', { name: 'New' });

      expect(updated).toEqual({ id: 'p1', name: 'New', timezone: 'UTC' });
    });
  });

  describe('remove', () => {
    it('deletes the project', async () => {
      const prisma = new FakePrisma();
      prisma.projects.push({ id: 'p1', orgId: 'org-1', name: 'X', timezone: 'UTC' });
      const { service } = makeService(prisma);

      await service.remove('p1');
      expect(prisma.projects).toHaveLength(0);
    });
  });

  describe('purgeData', () => {
    function seededPrisma() {
      const prisma = new FakePrisma();
      prisma.projects.push({ id: 'p1', orgId: 'org-1', name: 'X', timezone: 'UTC' });
      return prisma;
    }

    it('404s when the project does not exist, touching nothing', async () => {
      const prisma = new FakePrisma();
      const { service, clickhouse } = makeService(prisma);

      await expect(
        service.purgeData('missing', { scopes: { analytics: true } }),
      ).rejects.toMatchObject({ problem: { status: 404 } });
      expect(clickhouse.deleteProjectData).not.toHaveBeenCalled();
    });

    it('wipes only the analytics scope when only analytics is selected', async () => {
      const prisma = seededPrisma();
      const { service, clickhouse } = makeService(prisma);

      const result = await service.purgeData('p1', { scopes: { analytics: true } });

      expect(clickhouse.deleteProjectData).toHaveBeenCalledWith('p1');
      expect(prisma.subscriptionState.deleteMany).not.toHaveBeenCalled();
      expect(prisma.dashboard.deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual({ cleared: { analytics: true, revenuecat: false, saved: false } });
    });

    it('wipes revenuecat state + journal but keeps the integration row', async () => {
      const prisma = seededPrisma();
      const { service, clickhouse } = makeService(prisma);

      const result = await service.purgeData('p1', { scopes: { revenuecat: true } });

      expect(clickhouse.deleteProjectData).not.toHaveBeenCalled();
      expect(prisma.subscriptionState.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.revenueCatWebhookEvent.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
      });
      expect(result.cleared).toEqual({ analytics: false, revenuecat: true, saved: false });
    });

    it('wipes saved dashboards, cohorts and reports on the saved scope', async () => {
      const prisma = seededPrisma();
      const { service } = makeService(prisma);

      const result = await service.purgeData('p1', {
        scopes: { analytics: true, revenuecat: true, saved: true },
      });

      expect(prisma.dashboard.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.cohort.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.savedReport.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(result.cleared).toEqual({ analytics: true, revenuecat: true, saved: true });
    });
  });

  describe('listTokens', () => {
    it('returns only non-revoked tokens', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push(
        {
          id: 't1',
          projectId: 'p1',
          token: 'mam_a',
          label: 'default',
          revokedAt: null,
          createdAt: new Date(),
        },
        {
          id: 't2',
          projectId: 'p1',
          token: 'mam_b',
          label: 'old',
          revokedAt: new Date(),
          createdAt: new Date(),
        },
      );
      const { service } = makeService(prisma);

      const tokens = await service.listTokens('p1');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ id: 't1', token: 'mam_a', label: 'default' });
    });
  });

  describe('createToken', () => {
    it('creates a new mam_ token with the given label', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);
      const created = await service.createToken('p1', 'CI token');
      expect(created.label).toBe('CI token');
      expect(created.token).toMatch(/^mam_[0-9a-f]{32}$/);
    });

    it('defaults the label when omitted', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);
      const created = await service.createToken('p1');
      expect(created.label).toBe('default');
    });
  });

  describe('revokeToken', () => {
    const TOKEN_ID = '018f6b2e-0000-7000-8000-0000000000a1';
    const UNKNOWN_TOKEN_ID = '018f6b2e-0000-7000-8000-0000000000ff';

    it('sets revokedAt and deletes the guard cache entry — proves revocation takes effect immediately', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: TOKEN_ID,
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const { service, redis } = makeService(prisma);

      await service.revokeToken('p1', TOKEN_ID);

      expect(prisma.sdkTokens[0].revokedAt).not.toBeNull();
      expect(redis.del).toHaveBeenCalledWith(sdkTokenCacheKey('mam_abc'));
    });

    it('404s for an unknown (but UUID-shaped) token id', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);
      await expect(service.revokeToken('p1', UNKNOWN_TOKEN_ID)).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s for a malformed (non-UUID-shaped) token id without querying Postgres', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: TOKEN_ID,
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const findUniqueSpy = jest.spyOn(prisma.sdkToken, 'findUnique');
      const { service } = makeService(prisma);

      await expect(service.revokeToken('p1', 'not-a-uuid')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(findUniqueSpy).not.toHaveBeenCalled();
      expect(prisma.sdkTokens[0].revokedAt).toBeNull(); // untouched
    });

    it('404s when the token belongs to a DIFFERENT project — SECURITY-CRITICAL', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: TOKEN_ID,
        projectId: 'other-project',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const { service } = makeService(prisma);
      await expect(service.revokeToken('p1', TOKEN_ID)).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.sdkTokens[0].revokedAt).toBeNull(); // untouched
    });

    it('404s for an already-revoked token', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: TOKEN_ID,
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: new Date(),
        createdAt: new Date(),
      });
      const { service } = makeService(prisma);
      await expect(service.revokeToken('p1', TOKEN_ID)).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('still revokes even if the Redis cache delete fails (degrades gracefully)', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: TOKEN_ID,
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const { service } = makeService(prisma, {
        del: jest.fn().mockRejectedValue(new Error('redis down')) as unknown as Redis['del'],
      });

      await expect(service.revokeToken('p1', TOKEN_ID)).resolves.toBeUndefined();
      expect(prisma.sdkTokens[0].revokedAt).not.toBeNull();
    });
  });
});
