import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    membership: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    project: {
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
    it('maps memberships -> orgs -> projects into the flat list shape (contracts §12)', async () => {
      const prisma = makePrisma({
        membership: {
          findMany: jest.fn().mockResolvedValue([
            {
              userId: 'user-1',
              orgId: 'org-1',
              role: 'admin',
              org: {
                id: 'org-1',
                name: "Ada's Workspace",
                projects: [
                  {
                    id: 'project-1',
                    orgId: 'org-1',
                    name: 'Default',
                    timezone: 'UTC',
                    sdkTokens: [{ token: 'mam_' + 'a'.repeat(32) }],
                  },
                  {
                    id: 'project-2',
                    orgId: 'org-1',
                    name: 'Secondary',
                    timezone: 'Europe/Paris',
                    sdkTokens: [],
                  },
                ],
              },
            },
          ]),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      const projects = await service.listForUser('user-1');

      expect(prisma.membership.findMany).toHaveBeenCalledWith(
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
        },
        {
          id: 'project-2',
          org_id: 'org-1',
          org_name: "Ada's Workspace",
          name: 'Secondary',
          timezone: 'Europe/Paris',
          ingest_token: null,
        },
      ]);
    });

    it('flattens projects across multiple org memberships', async () => {
      const prisma = makePrisma({
        membership: {
          findMany: jest.fn().mockResolvedValue([
            {
              userId: 'user-1',
              orgId: 'org-1',
              org: { id: 'org-1', name: 'Org A', projects: [] },
            },
            {
              userId: 'user-1',
              orgId: 'org-2',
              org: {
                id: 'org-2',
                name: 'Org B',
                projects: [
                  {
                    id: 'project-3',
                    orgId: 'org-2',
                    name: 'B App',
                    timezone: 'UTC',
                    sdkTokens: [],
                  },
                ],
              },
            },
          ]),
        },
      });
      const service = makeService(prisma, makeClickhouse());

      const projects = await service.listForUser('user-1');

      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ id: 'project-3', org_id: 'org-2', org_name: 'Org B' });
    });

    it('returns an empty list for a user with no memberships', async () => {
      const service = makeService(makePrisma(), makeClickhouse());
      await expect(service.listForUser('lonely-user')).resolves.toEqual([]);
    });
  });

  describe('getEventsSummary', () => {
    const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
    const ORG_ID = '018f6b2e-0000-7000-8000-0000000000b1';
    const project = { id: PROJECT_ID, orgId: ORG_ID };
    const membership = { userId: 'user-1', orgId: ORG_ID, role: 'admin' };

    it('maps ClickHouse rows and sums the total, preserving desc order', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        membership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(membership),
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
        membership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(membership),
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

    it('throws 403 (not 404, not data) when the project exists but the user is not a member of its org — SECURITY-CRITICAL (contracts §12 3b)', async () => {
      const prisma = makePrisma({
        project: { findUnique: jest.fn().mockResolvedValue(project) },
        membership: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(null), // requester has no membership row for org-1
        },
      });
      const clickhouse = makeClickhouse([{ event: 'checkout_completed', count: '999' }]);
      const service = makeService(prisma, clickhouse);

      await expect(service.getEventsSummary('outsider-user', PROJECT_ID)).rejects.toMatchObject({
        problem: { status: 403 },
      });
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'outsider-user', orgId: ORG_ID } },
      });
      // Must never reach ClickHouse — a 403 must never leak org B's data.
      expect(clickhouse.query).not.toHaveBeenCalled();
    });
  });
});
