import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../test/integration/helpers/containers';

// Container pull + `prisma migrate deploy` easily exceeds Jest's 5s default outside the dedicated
// test:int config (see test/jest-integration.config.js, testTimeout: 300000).
jest.setTimeout(180000);

const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'prisma',
  'migrations',
  '20260711102417_backfill_org_owner',
  'migration.sql',
);

/**
 * Reads the exact backfill SQL shipped in the migration so this test runs the same statement
 * that ships to production rather than a hand-copied duplicate that could drift from it.
 */
function readBackfillSql(): string {
  return readFileSync(MIGRATION_SQL_PATH, 'utf8');
}

describe('Org owner backfill', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  async function roleOf(orgId: string, userId: string): Promise<string | undefined> {
    const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    return m?.role;
  }

  // startPostgresContainer() runs `prisma migrate deploy` as part of container startup, so the
  // backfill UPDATE in the migration already executed once against an empty database (no
  // memberships exist at that point — nothing to backfill). To verify the backfill logic itself
  // promotes the correct admin, seed org memberships here with controlled UUIDs, then re-run the
  // exact backfill SQL from the migration file and assert the resulting role mapping.
  it('promotes exactly one admin (smallest userId) per org to owner', async () => {
    const org = await prisma.organization.create({ data: { name: 'Backfill Org' } });
    const adminA = await prisma.user.create({
      data: {
        id: '00000000-0000-7000-8000-000000000001',
        email: 'admin-a@backfill.test',
        passwordHash: 'x',
        name: 'Admin A',
      },
    });
    const adminB = await prisma.user.create({
      data: {
        id: '00000000-0000-7000-8000-000000000002',
        email: 'admin-b@backfill.test',
        passwordHash: 'x',
        name: 'Admin B',
      },
    });
    const viewerUser = await prisma.user.create({
      data: { email: 'viewer@backfill.test', passwordHash: 'x', name: 'Viewer' },
    });
    await prisma.membership.create({ data: { userId: adminA.id, orgId: org.id, role: 'admin' } });
    await prisma.membership.create({ data: { userId: adminB.id, orgId: org.id, role: 'admin' } });
    await prisma.membership.create({
      data: { userId: viewerUser.id, orgId: org.id, role: 'viewer' },
    });

    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, adminA.id)).toBe('owner'); // smallest userId
    expect(await roleOf(org.id, adminB.id)).toBe('admin');
    expect(await roleOf(org.id, viewerUser.id)).toBe('viewer');

    const owners = await prisma.membership.count({ where: { orgId: org.id, role: 'owner' } });
    expect(owners).toBe(1);
  });

  it('leaves orgs with no admin unchanged', async () => {
    const org = await prisma.organization.create({ data: { name: 'No Admin Org' } });
    const analystUser = await prisma.user.create({
      data: { email: 'analyst@backfill.test', passwordHash: 'x', name: 'Analyst' },
    });
    await prisma.membership.create({
      data: { userId: analystUser.id, orgId: org.id, role: 'analyst' },
    });

    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, analystUser.id)).toBe('analyst');
    const owners = await prisma.membership.count({ where: { orgId: org.id, role: 'owner' } });
    expect(owners).toBe(0);
  });
});
