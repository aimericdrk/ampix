import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { sdkTokenCacheKey } from '../ingestion/sdk-token.guard';
import { ProjectManagementService } from './project-management.service';

interface FakeProject {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
}

interface FakeSdkToken {
  id: string;
  projectId: string;
  token: string;
  label: string;
  revokedAt: Date | null;
  createdAt: Date;
}

class FakePrisma {
  projects: FakeProject[] = [];
  sdkTokens: FakeSdkToken[] = [];
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
  };

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

  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

function makeService(prisma: FakePrisma, redis?: Partial<Redis>) {
  const fakeRedis = { del: jest.fn().mockResolvedValue(1), ...redis };
  return {
    service: new ProjectManagementService(
      prisma as unknown as PrismaService,
      fakeRedis as unknown as Redis,
    ),
    redis: fakeRedis,
  };
}

describe('ProjectManagementService', () => {
  describe('createForOrg', () => {
    it('creates the project + an initial SdkToken, atomically', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);

      const created = await service.createForOrg('org-1', 'New App', 'Europe/Paris');

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
      const created = await service.createForOrg('org-1', 'New App');
      expect(created.timezone).toBe('UTC');
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
    it('sets revokedAt and deletes the guard cache entry — proves revocation takes effect immediately', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: 't1',
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const { service, redis } = makeService(prisma);

      await service.revokeToken('p1', 't1');

      expect(prisma.sdkTokens[0].revokedAt).not.toBeNull();
      expect(redis.del).toHaveBeenCalledWith(sdkTokenCacheKey('mam_abc'));
    });

    it('404s for an unknown token id', async () => {
      const prisma = new FakePrisma();
      const { service } = makeService(prisma);
      await expect(service.revokeToken('p1', 'missing')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s when the token belongs to a DIFFERENT project — SECURITY-CRITICAL', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: 't1',
        projectId: 'other-project',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const { service } = makeService(prisma);
      await expect(service.revokeToken('p1', 't1')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.sdkTokens[0].revokedAt).toBeNull(); // untouched
    });

    it('404s for an already-revoked token', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: 't1',
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: new Date(),
        createdAt: new Date(),
      });
      const { service } = makeService(prisma);
      await expect(service.revokeToken('p1', 't1')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('still revokes even if the Redis cache delete fails (degrades gracefully)', async () => {
      const prisma = new FakePrisma();
      prisma.sdkTokens.push({
        id: 't1',
        projectId: 'p1',
        token: 'mam_abc',
        label: 'default',
        revokedAt: null,
        createdAt: new Date(),
      });
      const { service } = makeService(prisma, {
        del: jest.fn().mockRejectedValue(new Error('redis down')) as unknown as Redis['del'],
      });

      await expect(service.revokeToken('p1', 't1')).resolves.toBeUndefined();
      expect(prisma.sdkTokens[0].revokedAt).not.toBeNull();
    });
  });
});
