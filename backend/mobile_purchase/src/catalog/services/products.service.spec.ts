import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { ProductsService } from './products.service';

jest.setTimeout(180000);

describe('ProductsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: ProductsService;
  let projectId: string;
  let appId: string;
  let entitlementId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new ProductsService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    projectId = randomUUID();
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS', platform: 'IOS', bundleId: `com.a.b.${randomUUID()}`, publicSdkKey: `mp_pub_test_${randomUUID()}` },
    });
    appId = app.id;
    const ent = await prisma.entitlement.create({ data: { projectId, identifier: 'pro', displayName: 'Pro' } });
    entitlementId = ent.id;
  });

  it('creates a product and lists it', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'com.a.b.monthly',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      displayName: 'Monthly',
    });
    expect(product.appId).toBe(appId);
    const list = await service.list(projectId);
    expect(list.map((p) => p.id)).toContain(product.id);
  });

  it('rejects creating a product with an app id that belongs to another project', async () => {
    const otherProjectId = randomUUID();

    await expect(
      service.create(otherProjectId, {
        appId, // belongs to `projectId`, not `otherProjectId`
        storeProductId: 'foreign.product',
        type: 'CONSUMABLE',
        displayName: 'Foreign',
      }),
    ).rejects.toMatchObject({ problem: { status: 400 } });
  });

  it('rejects a duplicate storeProductId under the same app (@@unique([appId, storeProductId]))', async () => {
    await service.create(projectId, {
      appId,
      storeProductId: 'dup.product',
      type: 'CONSUMABLE',
      displayName: 'Dup',
    });

    await expect(
      service.create(projectId, {
        appId,
        storeProductId: 'dup.product',
        type: 'CONSUMABLE',
        displayName: 'Dup2',
      }),
    ).rejects.toMatchObject({ problem: { status: 409 } });
  });

  it('attaches two entitlements to a product and returns both via findUnique include', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'multi.ent.product',
      type: 'NON_CONSUMABLE',
      displayName: 'Multi',
    });
    const ent2 = await prisma.entitlement.create({ data: { projectId, identifier: 'plus', displayName: 'Plus' } });

    await service.attachEntitlement(projectId, product.id, entitlementId);
    await service.attachEntitlement(projectId, product.id, ent2.id);

    const found = await prisma.product.findUnique({ where: { id: product.id }, include: { entitlements: true } });
    expect(found?.entitlements.map((e) => e.entitlementId).sort()).toEqual([entitlementId, ent2.id].sort());
  });

  it('rejects attaching the same entitlement to a product twice', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'dup.ent.product',
      type: 'CONSUMABLE',
      displayName: 'DupEnt',
    });

    await service.attachEntitlement(projectId, product.id, entitlementId);
    await expect(service.attachEntitlement(projectId, product.id, entitlementId)).rejects.toMatchObject({
      problem: { status: 409 },
    });
  });

  it('404s attaching/detaching against a foreign-project product or entitlement', async () => {
    const otherProjectId = randomUUID();
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'attach.guard.product',
      type: 'CONSUMABLE',
      displayName: 'AttachGuard',
    });

    await expect(service.attachEntitlement(otherProjectId, product.id, entitlementId)).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(service.attachEntitlement(projectId, product.id, randomUUID())).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('404s attaching an entitlement that exists but belongs to a different project (cross-tenant guard)', async () => {
    const otherProjectId = randomUUID();
    const foreignEntitlement = await prisma.entitlement.create({
      data: { projectId: otherProjectId, identifier: 'foreign-pro', displayName: 'Foreign Pro' },
    });
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'foreign.entitlement.product',
      type: 'CONSUMABLE',
      displayName: 'ForeignEntitlement',
    });

    // The entitlement is REAL (not a random UUID) but scoped to `otherProjectId`, not
    // `projectId`. If the service ever drops the `projectId` filter on the entitlement lookup,
    // this attach would wrongly succeed, letting a product pull in another tenant's entitlement.
    await expect(service.attachEntitlement(projectId, product.id, foreignEntitlement.id)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('detachEntitlement is idempotent', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'detach.product',
      type: 'CONSUMABLE',
      displayName: 'Detach',
    });

    await service.attachEntitlement(projectId, product.id, entitlementId);
    await service.detachEntitlement(projectId, product.id, entitlementId);
    // Detaching again must not throw (deleteMany on an already-empty match).
    await expect(service.detachEntitlement(projectId, product.id, entitlementId)).resolves.not.toThrow();
  });

  it('remove() 404s for a cross-project or non-existent product', async () => {
    const otherProjectId = randomUUID();
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'cross.project.remove.product',
      type: 'CONSUMABLE',
      displayName: 'CrossProjectRemove',
    });

    await expect(service.remove(otherProjectId, product.id)).rejects.toMatchObject({ problem: { status: 404 } });
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('remove() 409s a product that is still referenced by a package', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'packaged.product',
      type: 'CONSUMABLE',
      displayName: 'Packaged',
    });
    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'packaged-offering', displayName: 'Packaged Offering' },
    });
    await prisma.package.create({
      data: { offeringId: offering.id, identifier: 'packaged-package', packageType: 'MONTHLY', productId: product.id },
    });

    await expect(service.remove(projectId, product.id)).rejects.toMatchObject({ problem: { status: 409 } });
  });
});
