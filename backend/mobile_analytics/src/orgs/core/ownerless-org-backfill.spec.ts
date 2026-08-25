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
  '20260824210000_backfill_ownerless_orgs',
  'migration.sql',
);

/**
 * Reads the exact SQL shipped in the migration, so this test exercises the statement that reaches
 * production rather than a hand-copied duplicate that could drift from it.
 */
function readBackfillSql(): string {
  return readFileSync(MIGRATION_SQL_PATH, 'utf8');
}

/**
 * Guards the repair for orgs provisioned by `AuthService.signup` while it still wrote an `admin`
 * membership — those orgs have no owner at all, and an ownerless org can never regain one (the
 * only path to `owner` is a transfer performed BY the current owner).
 */
describe('Ownerless org backfill', () => {
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

  let seq = 0;
  async function makeUser(id?: string): Promise<{ id: string }> {
    seq += 1;
    return prisma.user.create({
      data: {
        ...(id ? { id } : {}),
        email: `ownerless-${seq}@backfill.test`,
        passwordHash: 'x',
        name: `User ${seq}`,
      },
    });
  }

  it('promotes the smallest-userId admin in an org that has no owner', async () => {
    const org = await prisma.organization.create({ data: { name: 'Ownerless Org' } });
    const adminA = await makeUser('00000000-0000-7000-8000-0000000000a1');
    const adminB = await makeUser('00000000-0000-7000-8000-0000000000a2');
    const viewer = await makeUser();
    await prisma.membership.create({ data: { userId: adminA.id, orgId: org.id, role: 'admin' } });
    await prisma.membership.create({ data: { userId: adminB.id, orgId: org.id, role: 'admin' } });
    await prisma.membership.create({ data: { userId: viewer.id, orgId: org.id, role: 'viewer' } });

    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, adminA.id)).toBe('owner');
    expect(await roleOf(org.id, adminB.id)).toBe('admin');
    expect(await roleOf(org.id, viewer.id)).toBe('viewer');
    expect(await prisma.membership.count({ where: { orgId: org.id, role: 'owner' } })).toBe(1);
  });

  // The bug's real-world shape: signup provisioned exactly one `admin` membership and nothing else.
  it('repairs a single-admin personal workspace', async () => {
    const org = await prisma.organization.create({ data: { name: "Someone's Workspace" } });
    const solo = await makeUser();
    await prisma.membership.create({ data: { userId: solo.id, orgId: org.id, role: 'admin' } });

    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, solo.id)).toBe('owner');
  });

  // Must never demote or re-assign in an org that is already correct — the repair has to be safe
  // to run against a healthy database.
  it('leaves an org that already has an owner completely untouched', async () => {
    const org = await prisma.organization.create({ data: { name: 'Healthy Org' } });
    // Deliberately give the ADMIN the smaller id, so a rule that ignored the existing owner would
    // promote them and this assertion would catch it.
    const admin = await makeUser('00000000-0000-7000-8000-0000000000b1');
    const owner = await makeUser('00000000-0000-7000-8000-0000000000b2');
    await prisma.membership.create({ data: { userId: admin.id, orgId: org.id, role: 'admin' } });
    await prisma.membership.create({ data: { userId: owner.id, orgId: org.id, role: 'owner' } });

    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, admin.id)).toBe('admin');
    expect(await roleOf(org.id, owner.id)).toBe('owner');
    expect(await prisma.membership.count({ where: { orgId: org.id, role: 'owner' } })).toBe(1);
  });

  it('leaves an ownerless org with no admin unchanged', async () => {
    const org = await prisma.organization.create({ data: { name: 'Analyst Only Org' } });
    const analyst = await makeUser();
    await prisma.membership.create({
      data: { userId: analyst.id, orgId: org.id, role: 'analyst' },
    });

    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, analyst.id)).toBe('analyst');
    expect(await prisma.membership.count({ where: { orgId: org.id, role: 'owner' } })).toBe(0);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const org = await prisma.organization.create({ data: { name: 'Idempotent Org' } });
    const solo = await makeUser();
    await prisma.membership.create({ data: { userId: solo.id, orgId: org.id, role: 'admin' } });

    await prisma.$executeRawUnsafe(readBackfillSql());
    await prisma.$executeRawUnsafe(readBackfillSql());

    expect(await roleOf(org.id, solo.id)).toBe('owner');
    expect(await prisma.membership.count({ where: { orgId: org.id, role: 'owner' } })).toBe(1);
  });
});
