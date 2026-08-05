import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../test/integration/helpers/containers';

jest.setTimeout(180000);

// Smoke test against a real, self-contained Postgres (Testcontainers) — no dependency on
// infra/docker-compose.yml's mobile-purchase-postgres service being up.
describe('PromotionalEntitlement schema (smoke)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  const projectId = randomUUID();

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('persists a grant with its Customer/Entitlement relations and default timestamps', async () => {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `smoke-${randomUUID()}` } });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro', displayName: 'Pro' },
    });

    const grant = await prisma.promotionalEntitlement.create({
      data: { projectId, customerId: customer.id, entitlementId: entitlement.id, note: 'smoke test grant' },
    });

    expect(grant).toMatchObject({
      projectId,
      customerId: customer.id,
      entitlementId: entitlement.id,
      expiresAt: null,
      revokedAt: null,
      note: 'smoke test grant',
    });
    expect(grant.grantedAt).toBeInstanceOf(Date);
    expect(grant.startsAt).toBeInstanceOf(Date);

    await prisma.promotionalEntitlement.delete({ where: { id: grant.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.entitlement.delete({ where: { id: entitlement.id } });
  });

  it('cascades on Customer delete', async () => {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `smoke-${randomUUID()}` } });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro-cascade-customer', displayName: 'Pro' },
    });
    const grant = await prisma.promotionalEntitlement.create({
      data: { projectId, customerId: customer.id, entitlementId: entitlement.id },
    });

    await prisma.customer.delete({ where: { id: customer.id } });

    await expect(prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } })).resolves.toBeNull();
    await prisma.entitlement.delete({ where: { id: entitlement.id } });
  });

  it('cascades on Entitlement delete', async () => {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `smoke-${randomUUID()}` } });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro-cascade-entitlement', displayName: 'Pro' },
    });
    const grant = await prisma.promotionalEntitlement.create({
      data: { projectId, customerId: customer.id, entitlementId: entitlement.id },
    });

    await prisma.entitlement.delete({ where: { id: entitlement.id } });

    await expect(prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } })).resolves.toBeNull();
    await prisma.customer.delete({ where: { id: customer.id } });
  });
});
