import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { EntitlementMapService } from '../../subscribers/services/entitlement-map.service';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';
import { CustomerDetailService } from './customer-detail.service';

jest.setTimeout(180000);

describe('CustomerDetailService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: CustomerDetailService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new CustomerDetailService(
      prisma as never,
      new CustomerInfoAssemblerService(prisma as never, new EntitlementMapService(prisma as never)),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('404s when the customer does not exist in the project', async () => {
    await expect(service.getDetail(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('404s when the customer exists but belongs to a DIFFERENT project', async () => {
    const otherCustomer = await prisma.customer.create({ data: { projectId: randomUUID(), appUserId: 'not-mine' } });
    await expect(service.getDetail(projectId, otherCustomer.id)).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('returns the customer profile + empty customerInfo/subscriptions/transactions/promotionalEntitlements for a brand-new customer', async () => {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'brand-new' } });

    const detail = await service.getDetail(projectId, customer.id);

    expect(detail.customer).toEqual({
      id: customer.id,
      appUserId: 'brand-new',
      appleAppAccountToken: null,
      googleObfuscatedId: null,
      attributes: null,
      createdAt: customer.createdAt,
      lastSeenAt: null,
    });
    expect(detail.customerInfo.entitlements.active).toEqual({});
    expect(detail.subscriptions).toEqual([]);
    expect(detail.transactions).toEqual([]);
    expect(detail.promotionalEntitlements).toEqual([]);
  });

  it('returns subscriptions and transactions most-recent-first', async () => {
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS', platform: 'IOS', bundleId: `com.d.${randomUUID()}`, publicSdkKey: `mp_pub_test_${randomUUID()}` },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'history-user' } });
    const older = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        storeProductId: 'p1',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'EXPIRED',
        originalTransactionId: `orig-old-${randomUUID()}`,
        purchasedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const newer = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        storeProductId: 'p1',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        originalTransactionId: `orig-new-${randomUUID()}`,
        purchasedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    const detail = await service.getDetail(projectId, customer.id);
    expect(detail.subscriptions.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it('includes promotional entitlements (active + revoked) and reflects an active grant in customerInfo', async () => {
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'vip', displayName: 'VIP' },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'promo-user' } });
    const activeGrant = await prisma.promotionalEntitlement.create({
      data: {
        projectId,
        customerId: customer.id,
        entitlementId: entitlement.id,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: null,
        note: 'support goodwill',
      },
    });
    const revokedGrant = await prisma.promotionalEntitlement.create({
      data: {
        projectId,
        customerId: customer.id,
        entitlementId: entitlement.id,
        startsAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: new Date('2025-06-01T00:00:00.000Z'),
        revokedAt: new Date('2025-05-01T00:00:00.000Z'),
      },
    });

    const detail = await service.getDetail(projectId, customer.id);

    expect(detail.promotionalEntitlements.map((g) => g.id).sort()).toEqual([activeGrant.id, revokedGrant.id].sort());
    const activeRow = detail.promotionalEntitlements.find((g) => g.id === activeGrant.id);
    expect(activeRow).toMatchObject({ entitlementIdentifier: 'vip', expiresAt: null, revokedAt: null, note: 'support goodwill' });
    expect(detail.customerInfo.entitlements.active.vip).toMatchObject({ isActive: true, productIdentifier: 'promotional' });
  });
});
