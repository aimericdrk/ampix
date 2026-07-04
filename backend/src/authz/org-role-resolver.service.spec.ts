import type { PrismaService } from '../prisma/prisma.service';
import { OrgRoleResolverService, roleRank } from './org-role-resolver.service';

const ORG_ID = '018f6b2e-0000-7000-8000-0000000000a1';
const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000b1';
const TOKEN_ID = '018f6b2e-0000-7000-8000-0000000000c1';
const USER_ID = '018f6b2e-0000-7000-8000-0000000000d1';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    organization: { findUnique: jest.fn().mockResolvedValue(null) },
    project: { findUnique: jest.fn().mockResolvedValue(null) },
    sdkToken: { findUnique: jest.fn().mockResolvedValue(null) },
    membership: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function makeService(prisma: unknown) {
  return new OrgRoleResolverService(prisma as unknown as PrismaService);
}

describe('roleRank', () => {
  it('orders admin > analyst > viewer', () => {
    expect(roleRank('admin')).toBeGreaterThan(roleRank('analyst'));
    expect(roleRank('analyst')).toBeGreaterThan(roleRank('viewer'));
  });
});

describe('OrgRoleResolverService', () => {
  describe('resolveOrgId', () => {
    it('resolves directly from :orgId when the org exists', async () => {
      const prisma = makePrisma({
        organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG_ID, name: 'Org' }) },
      });
      const service = makeService(prisma);

      await expect(service.resolveOrgId({ orgId: ORG_ID })).resolves.toBe(ORG_ID);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { id: ORG_ID } });
    });

    it('404s for an unknown :orgId', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveOrgId({ orgId: ORG_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s for a malformed (non-UUID-shaped) :orgId without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveOrgId({ orgId: 'not-a-uuid' })).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it("resolves :projectId -> that project's org (project->org resolution)", async () => {
      const prisma = makePrisma({
        project: {
          findUnique: jest.fn().mockResolvedValue({ id: PROJECT_ID, orgId: ORG_ID }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolveOrgId({ projectId: PROJECT_ID })).resolves.toBe(ORG_ID);
      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: PROJECT_ID } });
    });

    it('404s for an unknown :projectId', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveOrgId({ projectId: PROJECT_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it("resolves :tokenId -> its project -> that project's org", async () => {
      const prisma = makePrisma({
        sdkToken: {
          findUnique: jest.fn().mockResolvedValue({ id: TOKEN_ID, projectId: PROJECT_ID }),
        },
        project: {
          findUnique: jest.fn().mockResolvedValue({ id: PROJECT_ID, orgId: ORG_ID }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolveOrgId({ tokenId: TOKEN_ID })).resolves.toBe(ORG_ID);
      expect(prisma.sdkToken.findUnique).toHaveBeenCalledWith({ where: { id: TOKEN_ID } });
    });

    it('404s for an unknown :tokenId', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveOrgId({ tokenId: TOKEN_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s when the token exists but its project has vanished (defensive)', async () => {
      const prisma = makePrisma({
        sdkToken: {
          findUnique: jest.fn().mockResolvedValue({ id: TOKEN_ID, projectId: PROJECT_ID }),
        },
        project: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = makeService(prisma);
      await expect(service.resolveOrgId({ tokenId: TOKEN_ID })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('throws a plain (non-Problem) error when no route param is present at all', async () => {
      const service = makeService(makePrisma());
      await expect(service.resolveOrgId({})).rejects.toThrow(
        'OrgRoleResolverService: route has no orgId/projectId/tokenId param',
      );
    });
  });

  describe('resolveMembership', () => {
    it('returns the role for an existing membership', async () => {
      const prisma = makePrisma({
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: USER_ID, orgId: ORG_ID, role: 'analyst' }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolveMembership(USER_ID, ORG_ID)).resolves.toBe('analyst');
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: USER_ID, orgId: ORG_ID } },
      });
    });

    it('403s for a non-member — SECURITY-CRITICAL', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma);
      await expect(service.resolveMembership(USER_ID, ORG_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
    });
  });

  describe('resolve', () => {
    it('composes org resolution + membership lookup', async () => {
      const prisma = makePrisma({
        organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG_ID, name: 'Org' }) },
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: USER_ID, orgId: ORG_ID, role: 'admin' }),
        },
      });
      const service = makeService(prisma);

      await expect(service.resolve(USER_ID, { orgId: ORG_ID })).resolves.toEqual({
        orgId: ORG_ID,
        role: 'admin',
      });
    });
  });
});
