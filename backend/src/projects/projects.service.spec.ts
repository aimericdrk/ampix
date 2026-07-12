import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    projectMembership: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function makeClickhouse(rows: unknown[] = []) {
  return { query: jest.fn().mockResolvedValue(rows) };
}

function makeService(prisma: unknown, clickhouse: unknown) {
  return new ProjectsService(prisma as unknown as PrismaService, clickhouse as ClickHouseService);
}

describe('ProjectsService', () => {
  describe('listForUser', () => {
    it('maps ProjectMemberships -> projects into the flat list shape, including role (contracts §12)', async () => {
      const prisma = makePrisma({
        projectMembership: {
          findMany: jest.fn().mockResolvedValue([
            {
              userId: 'user-1',
              projectId: 'project-1',
              role: 'owner',
              project: {
                id: 'project-1',
                orgId: 'org-1',
                name: 'Default',
                timezone: 'UTC',
                org: { id: 'org-1', name: "Ada's Workspace" },
                sdkTokens: [{ token: 'mam_' + 'a'.repeat(32) }],
                revenuecatIntegration: null,
              },
            },
            {
              userId: 'user-1',
              projectId: 'project-2',
              role: 'viewer',
              project: {
                id: 'project-2',
                orgId: 'org-1',
                name: 'Secondary',
                timezone: 'Europe/Paris',
                org: { id: 'org-1', name: "Ada's Workspace" },
                sdkTokens: [],
                revenuecatIntegration: null,
              },
            },
          ]),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      const projects = await service.listForUser('user-1');

      expect(prisma.projectMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
      expect(projects).toEqual([
        {
          id: 'project-1',
          org_id: 'org-1',
          org_name: "Ada's Workspace",
          name: 'Default',
          timezone: 'UTC',
          ingest_token: 'mam_' + 'a'.repeat(32),
          role: 'owner',
          integrations: { revenuecat: false },
        },
        {
          id: 'project-2',
          org_id: 'org-1',
          org_name: "Ada's Workspace",
          name: 'Secondary',
          timezone: 'Europe/Paris',
          ingest_token: null,
          role: 'viewer',
          integrations: { revenuecat: false },
        },
      ]);
    });

    it('returns only projects the user has a ProjectMembership on, across multiple orgs', async () => {
      const prisma = makePrisma({
        projectMembership: {
          findMany: jest.fn().mockResolvedValue([
            {
              userId: 'user-1',
              projectId: 'project-3',
              role: 'admin',
              project: {
                id: 'project-3',
                orgId: 'org-2',
                name: 'B App',
                timezone: 'UTC',
                org: { id: 'org-2', name: 'Org B' },
                sdkTokens: [],
                revenuecatIntegration: null,
              },
            },
          ]),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      const projects = await service.listForUser('user-1');

      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        id: 'project-3',
        org_id: 'org-2',
        org_name: 'Org B',
        role: 'admin',
      });
    });

    it('returns an empty list for a user with no project memberships', async () => {
      const service = makeService(makePrisma(), makeClickhouse());
      await expect(service.listForUser('lonely-user')).resolves.toEqual([]);
    });

    it('exposes integrations.revenuecat from the integration row presence', async () => {
      const membershipFixture = (overrides: { revenuecatIntegration: { id: string } | null }) => ({
        userId: 'user-1',
        projectId: 'project-1',
        role: 'owner',
        project: {
          id: 'project-1',
          orgId: 'org-1',
          name: 'Default',
          timezone: 'UTC',
          org: { id: 'org-1', name: "Ada's Workspace" },
          sdkTokens: [],
          ...overrides,
        },
      });
      const prisma = makePrisma({
        projectMembership: {
          findMany: jest.fn().mockResolvedValue([
            membershipFixture({ revenuecatIntegration: { id: 'int-1' } }),
            membershipFixture({ revenuecatIntegration: null }),
          ]),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      const items = await service.listForUser('user-1');

      expect(items[0].integrations).toEqual({ revenuecat: true });
      expect(items[1].integrations).toEqual({ revenuecat: false });
    });
  });

  describe('getEventsSummary', () => {
    const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
    const projectMembership = { userId: 'user-1', projectId: PROJECT_ID, role: 'admin' };
    const project = { id: PROJECT_ID, orgId: '018f6b2e-0000-7000-8000-0000000000b1' };

    it('maps ClickHouse rows and sums the total, preserving desc order', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(projectMembership),
        },
      });
      const clickhouse = makeClickhouse([
        { event: 'checkout_completed', count: '12' },
        { event: 'product_viewed', count: 40 },
      ]);
      const service = makeService(prisma, clickhouse);

      const summary = await service.getEventsSummary('user-1', PROJECT_ID);

      expect(clickhouse.query).toHaveBeenCalledWith(
        expect.stringContaining('count(DISTINCT insert_id)'),
        { projectId: PROJECT_ID },
      );
      expect(summary).toEqual({
        project_id: PROJECT_ID,
        total: 52,
        by_event: [
          { event: 'checkout_completed', count: 12 },
          { event: 'product_viewed', count: 40 },
        ],
      });
    });

    it('returns total: 0, by_event: [] for a project with no events', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(projectMembership),
        },
      });
      const service = makeService(prisma, makeClickhouse([]));

      await expect(service.getEventsSummary('user-1', PROJECT_ID)).resolves.toEqual({
        project_id: PROJECT_ID,
        total: 0,
        by_event: [],
      });
    });

    it('throws 404 for an unknown project id', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const clickhouse = makeClickhouse();
      const service = makeService(prisma, clickhouse);

      await expect(
        service.getEventsSummary('user-1', '018f6b2e-0000-7000-8000-000000000001'),
      ).rejects.toMatchObject({ problem: { status: 404 } });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });

    it('throws 404 for a malformed (non-UUID-shaped) project id without querying Postgres', async () => {
      const prisma = makePrisma();
      const service = makeService(prisma, makeClickhouse());

      await expect(service.getEventsSummary('user-1', 'not-a-uuid')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });

    it('throws 403 (not 404, not data) when the project exists but the user has no ProjectMembership on it — SECURITY-CRITICAL (contracts §12 3b)', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(null), // requester has no membership row for this project
        },
      });
      const clickhouse = makeClickhouse([{ event: 'checkout_completed', count: '999' }]);
      const service = makeService(prisma, clickhouse);

      await expect(service.getEventsSummary('outsider-user', PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(prisma.projectMembership.findUnique).toHaveBeenCalledWith({
        where: { userId_projectId: { userId: 'outsider-user', projectId: PROJECT_ID } },
      });
      // Must never reach ClickHouse — a 403 must never leak this project's data.
      expect(clickhouse.query).not.toHaveBeenCalled();
    });

    it('throws 403 for an ORG member who has never been granted a ProjectMembership on this specific project', async () => {
      // Simulates the flipped access model: being in the same org is no longer enough — only a
      // ProjectMembership row (or lack thereof) decides access now.
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(null),
        },
      });
      const clickhouse = makeClickhouse();
      const service = makeService(prisma, clickhouse);

      await expect(service.getEventsSummary('org-member-no-project', PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });

  describe('resolveProjectRole', () => {
    const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
    const project = { id: PROJECT_ID, orgId: '018f6b2e-0000-7000-8000-0000000000b1' };

    it('returns the caller role when a ProjectMembership row exists', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', projectId: PROJECT_ID, role: 'analyst' }),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      await expect(service.resolveProjectRole('user-1', PROJECT_ID)).resolves.toBe('analyst');
    });

    it('throws 403 for a user with no ProjectMembership row', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
      });
      const service = makeService(prisma, makeClickhouse());

      await expect(service.resolveProjectRole('outsider', PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
    });

    it('throws 404 for an unknown project id', async () => {
      const service = makeService(makePrisma(), makeClickhouse());

      await expect(
        service.resolveProjectRole('user-1', '018f6b2e-0000-7000-8000-000000000001'),
      ).rejects.toMatchObject({ problem: { status: 404 } });
    });

    it('resolves an org owner to project owner without a ProjectMembership row', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'org-owner', orgId: project.orgId, role: 'owner' }),
        },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(null), // no ProjectMembership row for this user
        },
      });
      const service = makeService(prisma, makeClickhouse());

      await expect(service.resolveProjectRole('org-owner', PROJECT_ID)).resolves.toBe('owner');
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'org-owner', orgId: project.orgId } },
      });
      // Derived access, no per-project row minted — must not fall through to the projectMembership lookup.
      expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
    });

    it('resolves an org owner to owner even when they also hold a lower ProjectMembership row', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'org-owner', orgId: project.orgId, role: 'owner' }),
        },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'org-owner', projectId: PROJECT_ID, role: 'viewer' }),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      // Org owner wins over the lower per-project row — derived owner access is additive.
      await expect(service.resolveProjectRole('org-owner', PROJECT_ID)).resolves.toBe('owner');
    });

    it('still 403s a non-owner org member with no project membership', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        membership: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'plain-org-member', orgId: project.orgId, role: 'analyst' }),
        },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(null),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      await expect(service.resolveProjectRole('plain-org-member', PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
    });
  });

  describe('assertMembership', () => {
    const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
    const project = { id: PROJECT_ID, orgId: '018f6b2e-0000-7000-8000-0000000000b1' };

    it('resolves (does not throw) for a member with a ProjectMembership row', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'user-1', projectId: PROJECT_ID, role: 'viewer' }),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      await expect(service.assertMembership('user-1', PROJECT_ID)).resolves.toBeUndefined();
    });

    it('throws 403 for an org member who lacks a ProjectMembership row on this project', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        projectMembership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(null),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      await expect(service.assertMembership('org-member-no-project', PROJECT_ID)).rejects.toMatchObject(
        { problem: { status: 403 } },
      );
    });
  });
});
