import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';

// Container pull + `prisma migrate deploy` easily exceeds Jest's 5s default outside the dedicated
// test:int config (see test/jest-integration.config.js, testTimeout: 300000).
jest.setTimeout(180000);

const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
  '20260710220252_per_project_roles',
  'migration.sql',
);
const BACKFILL_MARKER = '-- Backfill:';

/**
 * Extracts the backfill INSERT (everything from the `-- Backfill:` marker comment onward) so this
 * test runs the exact SQL shipped in the migration rather than a hand-copied duplicate that could
 * drift from it.
 */
function readBackfillSql(): string {
  const full = readFileSync(MIGRATION_SQL_PATH, 'utf8');
  const idx = full.indexOf(BACKFILL_MARKER);
  if (idx === -1) {
    throw new Error(`Backfill marker not found in ${MIGRATION_SQL_PATH}`);
  }
  return full.slice(idx);
}

describe('ProjectMembership backfill (per-project roles)', () => {
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

  // startPostgresContainer() runs `prisma migrate deploy` as part of container startup, so the
  // backfill INSERT in the migration already executed once against an empty database (no
  // memberships/projects exist at that point — nothing to backfill). To verify the backfill logic
  // itself preserves access correctly, seed an org membership + project here, then re-run the
  // exact backfill SQL from the migration file and assert the resulting role mapping.
  it('backfills admin as owner and analyst as analyst on existing projects', async () => {
    const org = await prisma.organization.create({ data: { name: 'Backfill Org' } });
    const adminUser = await prisma.user.create({
      data: { email: 'admin@backfill.test', passwordHash: 'x', name: 'Admin' },
    });
    const analystUser = await prisma.user.create({
      data: { email: 'analyst@backfill.test', passwordHash: 'x', name: 'Analyst' },
    });
    await prisma.membership.create({ data: { userId: adminUser.id, orgId: org.id, role: 'admin' } });
    await prisma.membership.create({
      data: { userId: analystUser.id, orgId: org.id, role: 'analyst' },
    });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'App' } });

    await prisma.$executeRawUnsafe(readBackfillSql());

    const rows = await prisma.projectMembership.findMany({ where: { projectId: project.id } });
    const byUser = new Map(rows.map((r) => [r.userId, r.role]));
    expect(byUser.get(adminUser.id)).toBe('owner');
    expect(byUser.get(analystUser.id)).toBe('analyst');
  });
});
