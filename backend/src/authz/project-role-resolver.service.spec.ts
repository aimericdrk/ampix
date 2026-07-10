import type { PrismaService } from '../prisma/prisma.service';
import { ProjectRoleResolverService, projectRoleRank } from './project-role-resolver.service';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000b1';
const TOKEN_ID = '018f6b2e-0000-7000-8000-0000000000c1';
const USER_ID = '018f6b2e-0000-7000-8000-0000000000d1';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    project: { findUnique: jest.fn().mockResolvedValue(null) },
    sdkToken: { findUnique: jest.fn().mockResolvedValue(null) },
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function makeService(prisma: unknown) {
  return new ProjectRoleResolverService(prisma as unknown as PrismaService);
}

describe('projectRoleRank', () => {
  it('orders owner > admin > analyst > viewer', () => {
    expect(projectRoleRank('owner')).toBeGreaterThan(projectRoleRank('admin'));
    expect(projectRoleRank('admin')).toBeGreaterThan(projectRoleRank('analyst'));
    expect(projectRoleRank('analyst')).toBeGreaterThan(projectRoleRank('viewer'));
  });
});

describe('ProjectRoleResolverService', () => {
  describe('resolveProjectId', () => {
    it('resolves directly from :projectId when the project exists', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue({ id: PROJECT_ID, orgId: 'org-1' }) },
      });
      const service = makeService(prisma);

      await expect(service.resolveProjectId({ projectId: PROJECT_ID })).resolves.toBe(PROJECT_ID);
      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: PROJECT_ID } });
    });

    it('404s for an unknown :projectId', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveProjectId({ projectId: PROJECT_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s for a malformed (non-UUID-shaped) :projectId without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveProjectId({ projectId: 'not-a-uuid' })).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });

    it("resolves :tokenId -> its project", async () => {
      const prisma = makePrisma({
        sdkToken: {
          findUnique: jest.fn().mockResolvedValue({ id: TOKEN_ID, projectId: PROJECT_ID }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolveProjectId({ tokenId: TOKEN_ID })).resolves.toBe(PROJECT_ID);
      expect(prisma.sdkToken.findUnique).toHaveBeenCalledWith({ where: { id: TOKEN_ID } });
    });

    it('404s for an unknown :tokenId', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveProjectId({ tokenId: TOKEN_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('throws a plain (non-Problem) error when no route param is present at all', async () => {
      const service = makeService(makePrisma());
      await expect(service.resolveProjectId({})).rejects.toThrow(
        'ProjectRoleResolverService: route has no projectId/tokenId param',
      );
    });
  });

  describe('resolveProjectRole', () => {
    it('returns the role for an existing membership', async () => {
      const prisma = makePrisma({
        projectMembership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: USER_ID, projectId: PROJECT_ID, role: 'analyst' }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolveProjectRole(USER_ID, PROJECT_ID)).resolves.toBe('analyst');
      expect(prisma.projectMembership.findUnique).toHaveBeenCalledWith({
        where: { userId_projectId: { userId: USER_ID, projectId: PROJECT_ID } },
      });
    });

    it('403s for a non-member — SECURITY-CRITICAL', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveProjectRole(USER_ID, PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
    });
  });

  describe('resolve', () => {
    it('composes project resolution + membership lookup', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue({ id: PROJECT_ID, orgId: 'org-1' }) },
        projectMembership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: USER_ID, projectId: PROJECT_ID, role: 'owner' }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolve(USER_ID, { projectId: PROJECT_ID })).resolves.toEqual({
        projectId: PROJECT_ID,
        role: 'owner',
      });
    });

    it('404s when the project is unknown before ever checking membership', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolve(USER_ID, { projectId: PROJECT_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
    });
  });
});
