import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { EntitlementMapService } from './entitlement-map.service';
import { CustomerInfoAssemblerService } from './customer-info-assembler.service';

jest.setTimeout(180000);

const NOW = new Date('2026-06-01T00:00:00.000Z').getTime();

describe('CustomerInfoAssemblerService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: CustomerInfoAssemblerService;
  let projectId: string;
  let appId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new CustomerInfoAssemblerService(prisma as never, new EntitlementMapService(prisma as never));
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

  it('assembles an empty CustomerInfo for a customer with no subscriptions or transactions', async () => {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'brand-new-user' } });

    const info = await service.assemble({ projectId, appId, customer }, NOW);

    expect(info.entitlements.active).toEqual({});
    expect(info.entitlements.all).toEqual({});
    expect(info.subscriptions).toEqual([]);
    expect(info.firstSeen).toEqual(customer.createdAt);
  });

  it('assembles CustomerInfo with an active entitlement from an ACTIVE subscription', async () => {
    const product = await prisma.product.create({
      data: {
        projectId,
        appId,
        storeProductId: 'com.a.b.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'premium', displayName: 'Premium' },
    });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: entitlement.id } });

    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'active-user' } });
    await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId,
        productId: product.id,
        storeProductId: 'com.a.b.monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        periodType: 'NORMAL',
        originalTransactionId: `orig-${randomUUID()}`,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        originalPurchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        autoRenewStatus: true,
      },
    });

    const info = await service.assemble({ projectId, appId, customer }, NOW);

    expect(Object.keys(info.entitlements.active)).toEqual(['premium']);
    const premium = info.entitlements.active.premium;
    expect(premium).toMatchObject({
      isActive: true,
      willRenew: true,
      store: 'app_store',
      productIdentifier: 'com.a.b.monthly',
      expirationDate: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(info.subscriptions).toHaveLength(1);
    expect(info.subscriptions[0]).toMatchObject({ storeProductId: 'com.a.b.monthly', isActive: true });
  });

  it('unions a non-revoked promotional grant into entitlements.active as promotionally-sourced', async () => {
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'promo-premium', displayName: 'Promo Premium' },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'promo-user' } });
    await prisma.promotionalEntitlement.create({
      data: {
        projectId,
        customerId: customer.id,
        entitlementId: entitlement.id,
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });

    const info = await service.assemble({ projectId, appId, customer }, NOW);

    expect(Object.keys(info.entitlements.active)).toEqual(['promo-premium']);
    expect(info.entitlements.active['promo-premium']).toMatchObject({
      isActive: true,
      willRenew: false,
      store: 'promotional',
      productIdentifier: 'promotional',
      expirationDate: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('resolves entitlements project-wide when appId is omitted — a subscription on a DIFFERENT App in the same project still resolves', async () => {
    const androidApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.a.b.android.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
    const androidProduct = await prisma.product.create({
      data: {
        projectId,
        appId: androidApp.id,
        storeProductId: 'com.a.b.android.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Android Monthly',
      },
    });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'cross-platform', displayName: 'Cross-platform' },
    });
    await prisma.productEntitlement.create({ data: { productId: androidProduct.id, entitlementId: entitlement.id } });

    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'cross-platform-user' } });
    await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: androidApp.id,
        productId: androidProduct.id,
        storeProductId: 'com.a.b.android.monthly',
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        periodType: 'NORMAL',
        purchaseToken: `token-${randomUUID()}`,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        autoRenewStatus: true,
      },
    });

    // No `appId` in params — this customer's App is Android, not the `appId` iOS App created in
    // beforeEach; a single-App-scoped resolution would miss this entitlement entirely.
    const info = await service.assemble({ projectId, customer }, NOW);

    expect(Object.keys(info.entitlements.active)).toEqual(['cross-platform']);
  });
});
