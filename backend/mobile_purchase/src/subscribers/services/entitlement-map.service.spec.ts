import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { EntitlementMapService } from './entitlement-map.service';

jest.setTimeout(180000);

describe('EntitlementMapService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: EntitlementMapService;
  let projectId: string;
  let appId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new EntitlementMapService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    projectId = randomUUID();
    const app = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.a.b.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
    appId = app.id;
  });

  it('returns an empty map for an App with no products', async () => {
    await expect(service.resolveEntitlementMap(appId)).resolves.toEqual(new Map());
  });

  it('maps a storeProductId to every entitlement identifier it grants', async () => {
    const monthly = await prisma.product.create({
      data: {
        projectId,
        appId,
        storeProductId: 'com.a.b.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });
    const pro = await prisma.entitlement.create({ data: { projectId, identifier: 'pro', displayName: 'Pro' } });
    const plus = await prisma.entitlement.create({ data: { projectId, identifier: 'plus', displayName: 'Plus' } });
    await prisma.productEntitlement.create({ data: { productId: monthly.id, entitlementId: pro.id } });
    await prisma.productEntitlement.create({ data: { productId: monthly.id, entitlementId: plus.id } });

    const map = await service.resolveEntitlementMap(appId);
    expect(map.get('com.a.b.monthly')?.slice().sort()).toEqual(['plus', 'pro']);
  });

  it('omits a storeProductId with no mapped entitlement — a missing key, not an empty array', async () => {
    await prisma.product.create({
      data: {
        projectId,
        appId,
        storeProductId: 'com.a.b.unmapped',
        type: 'CONSUMABLE',
        displayName: 'Unmapped',
      },
    });

    const map = await service.resolveEntitlementMap(appId);
    expect(map.has('com.a.b.unmapped')).toBe(false);
  });

  it('scopes products to the given appId only — another App in the same or a different project is excluded', async () => {
    const otherApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.a.b.android.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        projectId,
        appId: otherApp.id,
        storeProductId: 'com.a.b.other-app-product',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Other app product',
      },
    });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'other', displayName: 'Other' },
    });
    await prisma.productEntitlement.create({ data: { productId: otherProduct.id, entitlementId: entitlement.id } });

    const map = await service.resolveEntitlementMap(appId);
    expect(map.has('com.a.b.other-app-product')).toBe(false);
  });
});
