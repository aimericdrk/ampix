import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { OfferingResolverService } from './offering-resolver.service';

jest.setTimeout(180000);

describe('OfferingResolverService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: OfferingResolverService;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new OfferingResolverService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('returns null when no offering is current', async () => {
    const projectId = randomUUID();
    await expect(service.resolveCurrentOffering(projectId)).resolves.toBeNull();
  });

  it('resolves the current offering with packages sorted by sortOrder and entitlements flattened', async () => {
    const projectId = randomUUID();
    const app = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.a.b.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });

    const monthly = await prisma.product.create({
      data: {
        projectId,
        appId: app.id,
        storeProductId: 'com.a.b.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
        priceCents: 999,
        currency: 'USD',
        durationIso8601: 'P1M',
      },
    });
    const annual = await prisma.product.create({
      data: {
        projectId,
        appId: app.id,
        storeProductId: 'com.a.b.annual',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Annual',
        priceCents: 9999,
        currency: 'USD',
        durationIso8601: 'P1Y',
      },
    });

    const pro = await prisma.entitlement.create({ data: { projectId, identifier: 'pro', displayName: 'Pro' } });
    const plus = await prisma.entitlement.create({ data: { projectId, identifier: 'plus', displayName: 'Plus' } });
    await prisma.productEntitlement.create({ data: { productId: monthly.id, entitlementId: pro.id } });
    await prisma.productEntitlement.create({ data: { productId: monthly.id, entitlementId: plus.id } });
    await prisma.productEntitlement.create({ data: { productId: annual.id, entitlementId: pro.id } });

    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'default', displayName: 'Default', isCurrent: true, metadata: { foo: 'bar' } },
    });
    // Old offering that is NOT current — must not be picked up.
    await prisma.offering.create({ data: { projectId, identifier: 'legacy', displayName: 'Legacy', isCurrent: false } });

    // Insert out of sortOrder order to prove the resolver sorts rather than relying on insertion order.
    await prisma.package.create({
      data: { offeringId: offering.id, identifier: '$rc_annual', packageType: 'ANNUAL', productId: annual.id, sortOrder: 1 },
    });
    await prisma.package.create({
      data: { offeringId: offering.id, identifier: '$rc_monthly', packageType: 'MONTHLY', productId: monthly.id, sortOrder: 0 },
    });

    const resolved = await service.resolveCurrentOffering(projectId);

    expect(resolved).not.toBeNull();
    expect(resolved?.identifier).toBe('default');
    expect(resolved?.metadata).toEqual({ foo: 'bar' });
    expect(resolved?.packages.map((p) => p.identifier)).toEqual(['$rc_monthly', '$rc_annual']);

    const monthlyPkg = resolved?.packages[0];
    expect(monthlyPkg?.packageType).toBe('MONTHLY');
    expect(monthlyPkg?.product.storeProductId).toBe('com.a.b.monthly');
    expect(monthlyPkg?.product.priceCents).toBe(999);
    expect(monthlyPkg?.product.currency).toBe('USD');
    expect(monthlyPkg?.product.durationIso8601).toBe('P1M');
    expect(monthlyPkg?.product.entitlements.slice().sort()).toEqual(['plus', 'pro']);

    const annualPkg = resolved?.packages[1];
    expect(annualPkg?.product.entitlements).toEqual(['pro']);
  });
});
