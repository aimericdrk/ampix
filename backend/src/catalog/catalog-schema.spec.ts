import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../test/integration/helpers/containers';

jest.setTimeout(180000);

describe('rc_* catalog schema', () => {
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

  it('creates an app, product, entitlement, mapping, offering, and package', async () => {
    // Project.createdById is optional — no need to create a User (avoids guessing User's required fields).
    const org = await prisma.organization.create({ data: { name: 'O' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });

    const app = await prisma.app.create({
      data: { projectId: project.id, name: 'iOS', platform: 'IOS', bundleId: 'com.x.y', publicSdkKey: 'mrc_pub_test1' },
    });
    const product = await prisma.product.create({
      data: { projectId: project.id, appId: app.id, storeProductId: 'com.x.y.monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: 'Monthly' },
    });
    const ent = await prisma.entitlement.create({ data: { projectId: project.id, identifier: 'pro', displayName: 'Pro' } });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: ent.id } });
    const offering = await prisma.offering.create({ data: { projectId: project.id, identifier: 'default', displayName: 'Default', isCurrent: true } });
    const pkg = await prisma.package.create({
      data: { offeringId: offering.id, identifier: '$rc_monthly', packageType: 'MONTHLY', productId: product.id },
    });

    expect(pkg.packageType).toBe('MONTHLY');
    const withEnt = await prisma.product.findUnique({ where: { id: product.id }, include: { entitlements: true } });
    expect(withEnt?.entitlements).toHaveLength(1);
  });
});
