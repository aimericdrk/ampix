import { randomUUID } from 'node:crypto';
import { AppPlatform, PackageType, PrismaClient, ProductType } from '@prisma/client';
import { generatePublicSdkKey } from './support/key-generator';

// Smoke test against a real Postgres — no Testcontainers helper exists in this service yet, and
// spinning one up here would duplicate infra/docker-compose.yml's mobile-purchase-postgres
// service (already the canonical way this service gets a database, see prisma/migrations).
// Bring it up first: `docker compose -f infra/docker-compose.yml up -d mobile-purchase-postgres`.
const DEFAULT_DATABASE_URL = 'postgresql://mobile_purchase:mobile_purchase_dev@localhost:5433/mobile_purchase';

describe('catalog schema (smoke)', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL } },
  });
  const projectId = randomUUID();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists one row per catalog table plus the product<->entitlement mapping', async () => {
    const app = await prisma.app.create({
      data: {
        projectId,
        name: 'Smoke App',
        platform: AppPlatform.IOS,
        bundleId: 'com.myampix.smoke',
        publicSdkKey: generatePublicSdkKey(),
      },
    });

    const product = await prisma.product.create({
      data: {
        projectId,
        appId: app.id,
        storeProductId: 'com.myampix.smoke.pro.monthly',
        type: ProductType.AUTO_RENEWABLE_SUBSCRIPTION,
        displayName: 'Pro Monthly',
        priceCents: 999,
        currency: 'USD',
        durationIso8601: 'P1M',
      },
    });

    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro', displayName: 'Pro' },
    });

    await prisma.productEntitlement.create({
      data: { productId: product.id, entitlementId: entitlement.id },
    });

    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'default', displayName: 'Default', isCurrent: true },
    });

    const pkg = await prisma.package.create({
      data: {
        offeringId: offering.id,
        identifier: '$mp_monthly',
        packageType: PackageType.MONTHLY,
        productId: product.id,
      },
    });

    try {
      await expect(prisma.app.findUniqueOrThrow({ where: { id: app.id } })).resolves.toMatchObject({
        projectId,
        platform: 'IOS',
        bundleId: 'com.myampix.smoke',
        publicSdkKey: expect.stringMatching(/^mp_pub_[0-9a-f]{32}$/),
      });

      await expect(prisma.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({
        projectId,
        appId: app.id,
        storeProductId: 'com.myampix.smoke.pro.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      });

      await expect(prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } })).resolves.toMatchObject({
        projectId,
        identifier: 'pro',
      });

      await expect(
        prisma.productEntitlement.findUniqueOrThrow({
          where: { productId_entitlementId: { productId: product.id, entitlementId: entitlement.id } },
        }),
      ).resolves.toMatchObject({ productId: product.id, entitlementId: entitlement.id });

      await expect(prisma.offering.findUniqueOrThrow({ where: { id: offering.id } })).resolves.toMatchObject({
        projectId,
        identifier: 'default',
        isCurrent: true,
      });

      await expect(prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).resolves.toMatchObject({
        offeringId: offering.id,
        productId: product.id,
        packageType: 'MONTHLY',
      });
    } finally {
      // Cleanup respects the FK graph: Package->Product is onDelete: Restrict, so packages must
      // go before the product does. Deleting the offering first cascades its packages; deleting
      // the app then cascades products, which cascades product_entitlements.
      await prisma.offering.delete({ where: { id: offering.id } });
      await prisma.app.delete({ where: { id: app.id } });
      await prisma.entitlement.delete({ where: { id: entitlement.id } });
    }
  });
});
