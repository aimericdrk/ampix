import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { AppleIngestService } from './apple-ingest.service';
import { StoreNotificationJournalService } from '../journal/store-notification-journal.service';
import { CustomersService } from '../../customers/services/customers.service';
import { AppsService } from '../../catalog/services/apps.service';
import type { VerifiedAppleNotification } from './apple-notification-verifier';
import type { AppleDecodedTransactionInfo } from '../../subscriptions/lifecycle/apple-notification-mapper';

jest.setTimeout(180000);

function appleTransaction(overrides: Partial<AppleDecodedTransactionInfo> = {}): AppleDecodedTransactionInfo {
  return {
    transactionId: randomUUID(),
    originalTransactionId: randomUUID(),
    productId: 'com.myampix.premium.monthly',
    purchaseDate: new Date('2026-07-15T00:00:00Z'),
    expiresDate: new Date('2026-08-15T00:00:00Z'),
    type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED',
    offerType: undefined,
    revocationDate: undefined,
    price: 999,
    currency: 'USD',
    appAccountToken: undefined,
    ...overrides,
  };
}

function appleNotification(overrides: Partial<VerifiedAppleNotification> = {}): VerifiedAppleNotification {
  return {
    notificationType: 'SUBSCRIBED',
    subtype: 'INITIAL_BUY',
    notificationUUID: randomUUID(),
    signedDate: new Date('2026-07-15T00:00:00Z'),
    bundleId: 'com.myampix.app',
    environment: 'Sandbox',
    transaction: appleTransaction(),
    renewal: { autoRenewStatus: 1, autoRenewProductId: 'com.myampix.premium.monthly', gracePeriodExpiresDate: undefined },
    ...overrides,
  };
}

describe('AppleIngestService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let journal: StoreNotificationJournalService;
  let customersService: CustomersService;
  let appsService: AppsService;
  let service: AppleIngestService;
  let projectId: string;
  let appId: string;
  let bundleId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    journal = new StoreNotificationJournalService(prisma as never);
    customersService = new CustomersService(prisma as never);
    appsService = new AppsService(prisma as never);
    service = new AppleIngestService(prisma as never, journal, customersService, appsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    projectId = randomUUID();
    bundleId = `com.myampix.${randomUUID()}`;
    const app = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS Test App',
        platform: 'IOS',
        bundleId,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    appId = app.id;
  });

  async function bindCustomer(appUserId: string, token: string) {
    const customer = await customersService.getOrCreateCustomer(projectId, appUserId);
    return prisma.customer.update({ where: { id: customer.id }, data: { appleAppAccountToken: token } });
  }

  describe('unknown bundleId', () => {
    it('journals SKIPPED and creates no Transaction/Subscription', async () => {
      const decoded = appleNotification({ bundleId: 'com.unknown.bundle' });

      await service.handleVerifiedAppleNotification(decoded);

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: decoded.notificationUUID } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'SKIPPED', projectId: null, appId: null });
      expect(await prisma.transaction.count()).toBe(0);
    });

    it('a duplicate notificationUUID for an unknown bundleId is still an idempotent no-op', async () => {
      const decoded = appleNotification({ bundleId: 'com.unknown.bundle' });

      await service.handleVerifiedAppleNotification(decoded);
      await service.handleVerifiedAppleNotification(decoded);

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: decoded.notificationUUID } });
      expect(rows).toHaveLength(1);
    });
  });

  describe('INITIAL_BUY', () => {
    it('with a bound customer creates an ACTIVE Subscription + Transaction, journals PROCESSED, persists ownershipType', async () => {
      const token = randomUUID();
      const customer = await bindCustomer('user-1', token);
      const originalTransactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        transaction: appleTransaction({
          originalTransactionId,
          transactionId: originalTransactionId,
          appAccountToken: token,
          inAppOwnershipType: 'FAMILY_SHARED',
        }),
      });

      await service.handleVerifiedAppleNotification(decoded);

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('PROCESSED');

      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', originalTransactionId },
      });
      expect(subscription).toMatchObject({
        status: 'ACTIVE',
        customerId: customer.id,
        appId,
        ownershipType: 'FAMILY_SHARED',
        storeProductId: 'com.myampix.premium.monthly',
      });

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', storeTransactionId: originalTransactionId },
      });
      expect(transaction).toMatchObject({ customerId: customer.id, appId, subscriptionId: subscription.id, priceCents: 999, currency: 'USD' });
    });

    it('starts in TRIAL when offerType is FREE_TRIAL', async () => {
      const token = randomUUID();
      await bindCustomer('trial-user', token);
      const originalTransactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token, offerType: 'FREE_TRIAL' }),
      });

      await service.handleVerifiedAppleNotification(decoded);

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'APP_STORE', originalTransactionId } });
      expect(subscription.status).toBe('TRIAL');
      expect(subscription.periodType).toBe('TRIAL');
    });

    it('with NO bound customer (unbound token) creates a Transaction with customerId=null, no Subscription, journals UNLINKED', async () => {
      const originalTransactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: randomUUID() }),
      });

      await service.handleVerifiedAppleNotification(decoded);

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('UNLINKED');

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', storeTransactionId: originalTransactionId },
      });
      expect(transaction.customerId).toBeNull();

      const subscription = await prisma.subscription.findFirst({ where: { projectId, store: 'APP_STORE', originalTransactionId } });
      expect(subscription).toBeNull();
    });

    it('with no appAccountToken at all also defers as UNLINKED (Transaction still recorded)', async () => {
      const originalTransactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: undefined }),
      });

      await service.handleVerifiedAppleNotification(decoded);

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('UNLINKED');
      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', storeTransactionId: originalTransactionId },
      });
      expect(transaction.customerId).toBeNull();
    });

    it('replay: re-running the SAME journal row after the customer binds fills customerId and creates the Subscription', async () => {
      const token = randomUUID();
      const originalTransactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }),
      });

      await service.handleVerifiedAppleNotification(decoded);
      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('UNLINKED');

      // M5 dependency (flagged in the report): CustomersService has no explicit token-binding
      // method yet, so the bind is simulated directly here, as the brief instructs.
      const customer = await bindCustomer('replay-user', token);

      // M5 builds the actual replay loop (listUnlinkedForReplay -> re-decode payload -> this
      // call); here we call the re-runnable core directly against the existing row, exactly as
      // that loop will.
      await service.processJournaledNotification(journalRow.id, { id: appId, projectId }, decoded);

      const reJournalRow = await prisma.storeNotification.findUniqueOrThrow({ where: { id: journalRow.id } });
      expect(reJournalRow.status).toBe('PROCESSED');

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: decoded.notificationUUID } });
      expect(rows).toHaveLength(1); // still exactly one journal row — replay updates, never duplicates

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', storeTransactionId: originalTransactionId },
      });
      expect(transaction.customerId).toBe(customer.id);

      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', originalTransactionId },
      });
      expect(subscription.customerId).toBe(customer.id);
      expect(transaction.subscriptionId).toBe(subscription.id);
    });
  });

  describe('DID_RENEW', () => {
    it('extends expiry and creates a new Transaction row, linked to the same Subscription', async () => {
      const token = randomUUID();
      await bindCustomer('renew-user', token);
      const originalTransactionId = randomUUID();

      await service.handleVerifiedAppleNotification(
        appleNotification({
          bundleId,
          transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }),
        }),
      );

      const renewalTransactionId = randomUUID();
      const renewed = appleNotification({
        bundleId,
        notificationType: 'DID_RENEW',
        subtype: undefined,
        signedDate: new Date('2026-08-15T00:10:00Z'),
        transaction: appleTransaction({
          originalTransactionId,
          transactionId: renewalTransactionId,
          appAccountToken: token,
          purchaseDate: new Date('2026-08-15T00:00:00Z'),
          expiresDate: new Date('2026-09-15T00:00:00Z'),
        }),
      });
      await service.handleVerifiedAppleNotification(renewed);

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: renewed.notificationUUID } });
      expect(journalRow.status).toBe('PROCESSED');

      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', originalTransactionId },
      });
      expect(subscription.status).toBe('ACTIVE');
      expect(subscription.expiresAt).toEqual(new Date('2026-09-15T00:00:00Z'));

      const txnCount = await prisma.transaction.count({ where: { projectId, originalTransactionId } });
      expect(txnCount).toBe(2);
    });
  });

  describe('DID_CHANGE_RENEWAL_STATUS / AUTO_RENEW_DISABLED', () => {
    it('sets CANCELLED + autoRenewStatus=false + unsubscribeDetectedAt, keeps expiresAt (still entitled until expiry)', async () => {
      const token = randomUUID();
      await bindCustomer('cancel-user', token);
      const originalTransactionId = randomUUID();

      await service.handleVerifiedAppleNotification(
        appleNotification({
          bundleId,
          transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }),
        }),
      );

      const cancelled = appleNotification({
        bundleId,
        notificationType: 'DID_CHANGE_RENEWAL_STATUS',
        subtype: 'AUTO_RENEW_DISABLED',
        signedDate: new Date('2026-07-20T00:00:00Z'),
        transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }),
      });
      await service.handleVerifiedAppleNotification(cancelled);

      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', originalTransactionId },
      });
      expect(subscription.status).toBe('CANCELLED');
      expect(subscription.autoRenewStatus).toBe(false);
      expect(subscription.unsubscribeDetectedAt).not.toBeNull();
      expect(subscription.expiresAt).toEqual(new Date('2026-08-15T00:00:00Z')); // unchanged — still entitled until expiry
    });
  });

  describe('REFUND', () => {
    it('marks the Transaction revokedAt and the Subscription REVOKED', async () => {
      const token = randomUUID();
      await bindCustomer('refund-user', token);
      const originalTransactionId = randomUUID();

      await service.handleVerifiedAppleNotification(
        appleNotification({
          bundleId,
          transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }),
        }),
      );

      const revocationDate = new Date('2026-07-21T00:00:00Z');
      const refunded = appleNotification({
        bundleId,
        notificationType: 'REFUND',
        subtype: undefined,
        signedDate: new Date('2026-07-21T00:00:00Z'),
        transaction: appleTransaction({
          originalTransactionId,
          transactionId: originalTransactionId,
          appAccountToken: token,
          revocationDate,
        }),
      });
      await service.handleVerifiedAppleNotification(refunded);

      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', originalTransactionId },
      });
      expect(subscription.status).toBe('REVOKED');

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', storeTransactionId: originalTransactionId },
      });
      expect(transaction.revokedAt).toEqual(revocationDate);
    });
  });

  describe('duplicate notificationUUID', () => {
    it('is an idempotent no-op: no second journal row, no duplicate Transaction, no reprocessing', async () => {
      const token = randomUUID();
      await bindCustomer('dup-user', token);
      const originalTransactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        transaction: appleTransaction({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }),
      });

      await service.handleVerifiedAppleNotification(decoded);
      await service.handleVerifiedAppleNotification(decoded);

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: decoded.notificationUUID } });
      expect(rows).toHaveLength(1);

      const txns = await prisma.transaction.findMany({ where: { projectId, originalTransactionId } });
      expect(txns).toHaveLength(1);
    });
  });

  describe('a handler throw', () => {
    it('a mid-lifecycle event with no prior subscription journals FAILED (replayable) and never rejects', async () => {
      const token = randomUUID();
      await bindCustomer('failed-user', token);
      const originalTransactionId = randomUUID(); // never seen before — no prior Subscription row
      const decoded = appleNotification({
        bundleId,
        notificationType: 'DID_RENEW',
        subtype: undefined,
        transaction: appleTransaction({ originalTransactionId, transactionId: randomUUID(), appAccountToken: token }),
      });

      await expect(service.handleVerifiedAppleNotification(decoded)).resolves.toBeUndefined();

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('FAILED');
      expect(journalRow.error).toContain('cannot apply');

      // Revenue is still recorded even though the lifecycle step failed (RC-faithful — the
      // Transaction upsert happens before the Subscription resolution).
      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', originalTransactionId },
      });
      expect(transaction.customerId).not.toBeNull();
    });
  });

  describe('ONE_TIME_CHARGE', () => {
    it('creates a Transaction only (no Subscription), journals PROCESSED', async () => {
      const token = randomUUID();
      const customer = await bindCustomer('onetime-user', token);
      const transactionId = randomUUID();
      const decoded = appleNotification({
        bundleId,
        notificationType: 'ONE_TIME_CHARGE',
        subtype: undefined,
        transaction: appleTransaction({
          originalTransactionId: transactionId,
          transactionId,
          appAccountToken: token,
          type: 'Consumable',
          expiresDate: undefined,
        }),
      });

      await service.handleVerifiedAppleNotification(decoded);

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('PROCESSED');

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { projectId, store: 'APP_STORE', storeTransactionId: transactionId },
      });
      expect(transaction).toMatchObject({ customerId: customer.id, type: 'CONSUMABLE', subscriptionId: null });

      const subscription = await prisma.subscription.findFirst({ where: { projectId, store: 'APP_STORE', originalTransactionId: transactionId } });
      expect(subscription).toBeNull();
    });
  });

  describe('NO_OP (TEST notification)', () => {
    it('journals PROCESSED with no Transaction/Subscription side effects', async () => {
      const decoded = appleNotification({
        bundleId,
        notificationType: 'TEST',
        subtype: undefined,
        transaction: undefined,
        renewal: undefined,
      });

      await service.handleVerifiedAppleNotification(decoded);

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: decoded.notificationUUID } });
      expect(journalRow.status).toBe('PROCESSED');
      expect(await prisma.transaction.count({ where: { projectId } })).toBe(0);
      expect(await prisma.subscription.count({ where: { projectId } })).toBe(0);
    });
  });
});
