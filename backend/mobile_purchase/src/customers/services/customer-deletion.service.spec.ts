import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { CustomerDeletionService } from './customer-deletion.service';

jest.setTimeout(180000);

describe('CustomerDeletionService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: CustomerDeletionService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new CustomerDeletionService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('deletes the customer, cascades subscriptions + promotional entitlements, and preserves transactions with customerId set to NULL', async () => {
    const app = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.del.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `del-${randomUUID()}` } });
    const entitlement = await prisma.entitlement.create({ data: { projectId, identifier: 'pro', displayName: 'Pro' } });

    const subscription = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        storeProductId: 'sub.monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        originalTransactionId: `orig-${randomUUID()}`,
        purchasedAt: new Date(),
      },
    });
    const grant = await prisma.promotionalEntitlement.create({
      data: { projectId, customerId: customer.id, entitlementId: entitlement.id, expiresAt: null },
    });
    const transaction = await prisma.transaction.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        storeTransactionId: `txn-${randomUUID()}`,
        storeProductId: 'sub.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date(),
        rawPayload: {},
      },
    });

    await service.remove(projectId, customer.id);

    expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeNull();
    expect(await prisma.subscription.findUnique({ where: { id: subscription.id } })).toBeNull();
    expect(await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } })).toBeNull();

    const survivingTransaction = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(survivingTransaction).not.toBeNull();
    expect(survivingTransaction?.customerId).toBeNull();
  });

  it('404s deleting a non-existent or cross-tenant customer', async () => {
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });

    const otherProjectId = randomUUID();
    const foreignCustomer = await prisma.customer.create({
      data: { projectId: otherProjectId, appUserId: `foreign-${randomUUID()}` },
    });
    await expect(service.remove(projectId, foreignCustomer.id)).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('removeByAppUserId deletes the customer and scrubs store_notifications journal rows in place (happy path)', async () => {
    const appUserId = `erase-${randomUUID()}`;
    const customer = await prisma.customer.create({ data: { projectId, appUserId } });
    const notification = await prisma.storeNotification.create({
      data: {
        projectId,
        store: 'APP_STORE',
        storeEventId: `evt-${randomUUID()}`,
        notificationType: 'DID_RENEW',
        appUserId,
        payload: { appAccountToken: 'sensitive' },
        status: 'PROCESSED',
      },
    });

    const result = await service.removeByAppUserId(projectId, appUserId);

    expect(result).toEqual({ customerDeleted: true, storeNotificationsScrubbed: 1 });
    expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeNull();
    const scrubbed = await prisma.storeNotification.findUnique({ where: { id: notification.id } });
    expect(scrubbed).not.toBeNull();
    expect(scrubbed?.appUserId).toBeNull();
    expect(scrubbed?.payload).toEqual({});
    expect(scrubbed?.storeEventId).toBe(notification.storeEventId);
  });

  it('removeByAppUserId is idempotent for an unknown appUserId and never crosses tenants (edge case)', async () => {
    await expect(service.removeByAppUserId(projectId, `ghost-${randomUUID()}`)).resolves.toEqual({
      customerDeleted: false,
      storeNotificationsScrubbed: 0,
    });

    const otherProjectId = randomUUID();
    const appUserId = `tenant-${randomUUID()}`;
    const foreignCustomer = await prisma.customer.create({
      data: { projectId: otherProjectId, appUserId },
    });
    const foreignNotification = await prisma.storeNotification.create({
      data: {
        projectId: otherProjectId,
        store: 'PLAY_STORE',
        storeEventId: `evt-${randomUUID()}`,
        notificationType: 'SUBSCRIPTION_RENEWED',
        appUserId,
        payload: { token: 'keep-me' },
        status: 'PROCESSED',
      },
    });

    const result = await service.removeByAppUserId(projectId, appUserId);

    expect(result).toEqual({ customerDeleted: false, storeNotificationsScrubbed: 0 });
    expect(await prisma.customer.findUnique({ where: { id: foreignCustomer.id } })).not.toBeNull();
    const untouched = await prisma.storeNotification.findUnique({ where: { id: foreignNotification.id } });
    expect(untouched?.appUserId).toBe(appUserId);
    expect(untouched?.payload).toEqual({ token: 'keep-me' });
  });
});
