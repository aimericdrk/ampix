import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { GoogleIngestService } from './google-ingest.service';
import { StoreNotificationJournalService } from '../journal/store-notification-journal.service';
import { CustomersService } from '../../customers/services/customers.service';
import { InMemoryStoreClient } from './store-client.in-memory';
import type { GoogleSubscriptionV2, StoreClient } from './store-client';
import type { DeveloperNotification } from './google-notification-envelope';

jest.setTimeout(180000);

const PACKAGE_NAME = 'com.myampix.app';

function subscriptionNotification(purchaseToken: string, notificationType: number, eventTimeMillis = '2026-07-15T00:00:00Z'): DeveloperNotification {
  return {
    version: '1.0',
    packageName: PACKAGE_NAME,
    eventTimeMillis: String(Date.parse(eventTimeMillis)),
    subscriptionNotification: { version: '1.0', notificationType, purchaseToken, subscriptionId: 'sub-monthly' },
  };
}

function fetchedSubscription(overrides: Partial<GoogleSubscriptionV2> = {}): GoogleSubscriptionV2 {
  return {
    kind: 'androidpublisher#subscriptionPurchaseV2',
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    latestOrderId: `GPA.${randomUUID()}`,
    lineItems: [
      {
        productId: 'com.myampix.premium.monthly',
        expiryTime: '2026-08-15T00:00:00Z',
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
    ...overrides,
  };
}

describe('GoogleIngestService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let journal: StoreNotificationJournalService;
  let customersService: CustomersService;
  let storeClient: InMemoryStoreClient;
  let service: GoogleIngestService;
  let projectId: string;
  let appId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    journal = new StoreNotificationJournalService(prisma as never);
    customersService = new CustomersService(prisma as never);
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
        name: 'Android Test App',
        platform: 'ANDROID',
        packageName: PACKAGE_NAME,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    appId = app.id;
    storeClient = new InMemoryStoreClient();
    service = new GoogleIngestService(prisma as never, journal, customersService, storeClient);
  });

  async function bindCustomer(appUserId: string, token: string) {
    const customer = await customersService.getOrCreateCustomer(projectId, appUserId);
    return prisma.customer.update({ where: { id: customer.id }, data: { googleObfuscatedId: token } });
  }

  describe('unknown packageName', () => {
    it('journals SKIPPED and creates no Transaction/Subscription', async () => {
      const notification = subscriptionNotification(randomUUID(), 4);
      notification.packageName = 'com.unknown.package';

      await service.handleDeveloperNotification(notification, null, 'msg-unknown-app');

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: 'msg-unknown-app' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'SKIPPED', projectId: null, appId: null });
      expect(await prisma.transaction.count()).toBe(0);
    });

    it('a duplicate messageId for an unknown packageName is still an idempotent no-op', async () => {
      const notification = subscriptionNotification(randomUUID(), 4);
      notification.packageName = 'com.unknown.package';

      await service.handleDeveloperNotification(notification, null, 'msg-unknown-dup');
      await service.handleDeveloperNotification(notification, null, 'msg-unknown-dup');

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: 'msg-unknown-dup' } });
      expect(rows).toHaveLength(1);
    });
  });

  describe('duplicate messageId (known App)', () => {
    it('is an idempotent no-op: no second journal row, no duplicate Transaction, no reprocessing', async () => {
      const token = randomUUID();
      await bindCustomer('dup-user', token);
      const purchaseToken = randomUUID();
      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );
      const notification = subscriptionNotification(purchaseToken, 4);

      await service.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-dup');
      await service.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-dup');

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: 'msg-dup' } });
      expect(rows).toHaveLength(1);
      const txns = await prisma.transaction.findMany({ where: { projectId, store: 'PLAY_STORE' } });
      expect(txns).toHaveLength(1);
    });
  });

  describe('testNotification', () => {
    it('journals PROCESSED with no Transaction/Subscription side effects', async () => {
      const notification: DeveloperNotification = {
        version: '1.0',
        packageName: PACKAGE_NAME,
        eventTimeMillis: '1721030400000',
        testNotification: { version: '1.0' },
      };

      await service.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-test');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-test' } });
      expect(journalRow.status).toBe('PROCESSED');
      expect(await prisma.transaction.count({ where: { projectId } })).toBe(0);
      expect(await prisma.subscription.count({ where: { projectId } })).toBe(0);
    });
  });

  describe('PURCHASED (notificationType 4)', () => {
    it('with a bound customer creates an ACTIVE Subscription + Transaction, journals PROCESSED', async () => {
      const token = randomUUID();
      const customer = await bindCustomer('user-1', token);
      const purchaseToken = randomUUID();
      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );

      await service.handleDeveloperNotification(subscriptionNotification(purchaseToken, 4), { id: appId, projectId }, 'msg-purchased');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-purchased' } });
      expect(journalRow.status).toBe('PROCESSED');

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscription).toMatchObject({
        status: 'ACTIVE',
        customerId: customer.id,
        appId,
        storeProductId: 'com.myampix.premium.monthly',
        environment: 'PRODUCTION',
      });

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE' } });
      expect(transaction).toMatchObject({ customerId: customer.id, appId, subscriptionId: subscription.id });
    });

    it('with NO bound customer (unbound obfuscatedExternalAccountId) creates a Transaction with customerId=null, no Subscription, journals UNLINKED; replay after bind links it', async () => {
      const token = randomUUID();
      const purchaseToken = randomUUID();
      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );
      const notification = subscriptionNotification(purchaseToken, 4);

      await service.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-unlinked');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-unlinked' } });
      expect(journalRow.status).toBe('UNLINKED');

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE' } });
      expect(transaction.customerId).toBeNull();

      const subscriptionBefore = await prisma.subscription.findFirst({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscriptionBefore).toBeNull();

      // M5 dependency (flagged in the report, mirrors AppleIngestService's own spec): no explicit
      // token-binding endpoint yet, so the bind is simulated directly here.
      const customer = await bindCustomer('replay-user', token);

      await service.processJournaledNotification(journalRow.id, { id: appId, projectId }, notification);

      const reJournalRow = await prisma.storeNotification.findUniqueOrThrow({ where: { id: journalRow.id } });
      expect(reJournalRow.status).toBe('PROCESSED');

      const rows = await prisma.storeNotification.findMany({ where: { storeEventId: 'msg-unlinked' } });
      expect(rows).toHaveLength(1); // still exactly one journal row — replay updates, never duplicates

      const transactionAfter = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE' } });
      expect(transactionAfter.customerId).toBe(customer.id);

      const subscriptionAfter = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscriptionAfter.customerId).toBe(customer.id);
      expect(transactionAfter.subscriptionId).toBe(subscriptionAfter.id);
    });
  });

  describe('RENEWED (notificationType 2)', () => {
    it('extends expiry and creates a new Transaction row, linked to the same Subscription', async () => {
      const token = randomUUID();
      await bindCustomer('renew-user', token);
      const purchaseToken = randomUUID();
      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );
      await service.handleDeveloperNotification(subscriptionNotification(purchaseToken, 4), { id: appId, projectId }, 'msg-init-renew');

      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({
          latestOrderId: `GPA.${randomUUID()}`,
          lineItems: [{ productId: 'com.myampix.premium.monthly', expiryTime: '2026-09-15T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
          externalAccountIdentifiers: { obfuscatedExternalAccountId: token },
        }),
      );
      await service.handleDeveloperNotification(
        subscriptionNotification(purchaseToken, 2, '2026-08-15T00:10:00Z'),
        { id: appId, projectId },
        'msg-renewed',
      );

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-renewed' } });
      expect(journalRow.status).toBe('PROCESSED');

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscription.status).toBe('ACTIVE');
      expect(subscription.expiresAt).toEqual(new Date('2026-09-15T00:00:00Z'));

      const txnCount = await prisma.transaction.count({ where: { projectId, store: 'PLAY_STORE' } });
      expect(txnCount).toBe(2);
    });
  });

  describe('CANCELED (notificationType 3)', () => {
    it('sets CANCELLED + autoRenewStatus=false (willRenew=false), keeps expiresAt (still entitled until expiry)', async () => {
      const token = randomUUID();
      await bindCustomer('cancel-user', token);
      const purchaseToken = randomUUID();
      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );
      await service.handleDeveloperNotification(subscriptionNotification(purchaseToken, 4), { id: appId, projectId }, 'msg-init-cancel');

      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          externalAccountIdentifiers: { obfuscatedExternalAccountId: token },
        }),
      );
      await service.handleDeveloperNotification(
        subscriptionNotification(purchaseToken, 3, '2026-07-20T00:00:00Z'),
        { id: appId, projectId },
        'msg-canceled',
      );

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscription.status).toBe('CANCELLED');
      expect(subscription.autoRenewStatus).toBe(false);
      expect(subscription.unsubscribeDetectedAt).not.toBeNull();
      expect(subscription.expiresAt).toEqual(new Date('2026-08-15T00:00:00Z')); // unchanged — still entitled until expiry

      // A status-only transition (design §1.2's table names "Transaction" for RENEWED/PURCHASED
      // only) — no second Transaction created.
      const txnCount = await prisma.transaction.count({ where: { projectId, store: 'PLAY_STORE' } });
      expect(txnCount).toBe(1);
    });
  });

  describe('voidedPurchaseNotification', () => {
    it('marks the matching Transaction revokedAt and drives the Subscription to REVOKED', async () => {
      const token = randomUUID();
      const customer = await bindCustomer('void-user', token);
      const purchaseToken = randomUUID();
      const orderId = `GPA.${randomUUID()}`;
      storeClient.seedSubscription(
        PACKAGE_NAME,
        purchaseToken,
        fetchedSubscription({ latestOrderId: orderId, externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );
      await service.handleDeveloperNotification(subscriptionNotification(purchaseToken, 4), { id: appId, projectId }, 'msg-init-void');

      const voided: DeveloperNotification = {
        version: '1.0',
        packageName: PACKAGE_NAME,
        eventTimeMillis: String(Date.parse('2026-07-21T00:00:00Z')),
        voidedPurchaseNotification: { purchaseToken, orderId, productType: 1, refundType: 1 },
      };
      await service.handleDeveloperNotification(voided, { id: appId, projectId }, 'msg-voided');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-voided' } });
      expect(journalRow.status).toBe('PROCESSED');

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscription.status).toBe('REVOKED');

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', storeTransactionId: orderId } });
      expect(transaction.revokedAt).not.toBeNull();
      expect(transaction.customerId).toBe(customer.id);
    });

    it('a voided one-time product (productType 2) only marks the Transaction — no Subscription lookup', async () => {
      const purchaseToken = randomUUID();
      const orderId = `GPA.${randomUUID()}`;
      await prisma.transaction.create({
        data: {
          projectId,
          appId,
          store: 'PLAY_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: orderId,
          storeProductId: 'coins_100',
          type: 'CONSUMABLE',
          purchasedAt: new Date('2026-07-10T00:00:00Z'),
          rawPayload: {},
        },
      });

      const voided: DeveloperNotification = {
        version: '1.0',
        packageName: PACKAGE_NAME,
        eventTimeMillis: String(Date.parse('2026-07-21T00:00:00Z')),
        voidedPurchaseNotification: { purchaseToken, orderId, productType: 2, refundType: 1 },
      };
      await service.handleDeveloperNotification(voided, { id: appId, projectId }, 'msg-voided-onetime');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-voided-onetime' } });
      expect(journalRow.status).toBe('PROCESSED');

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', storeTransactionId: orderId } });
      expect(transaction.revokedAt).not.toBeNull();
      expect(await prisma.subscription.count({ where: { projectId } })).toBe(0);
    });
  });

  describe('oneTimeProductNotification', () => {
    it('creates a Transaction only (no Subscription), journals PROCESSED', async () => {
      const token = randomUUID();
      const customer = await bindCustomer('onetime-user', token);
      const purchaseToken = randomUUID();
      const orderId = `GPA.${randomUUID()}`;
      storeClient.seedProduct(PACKAGE_NAME, 'coins_100', purchaseToken, {
        orderId,
        obfuscatedExternalAccountId: token,
        purchaseTimeMillis: String(Date.parse('2026-07-15T00:00:00Z')),
      });
      const notification: DeveloperNotification = {
        version: '1.0',
        packageName: PACKAGE_NAME,
        eventTimeMillis: String(Date.parse('2026-07-15T00:00:00Z')),
        oneTimeProductNotification: { version: '1.0', notificationType: 1, purchaseToken, sku: 'coins_100' },
      };

      await service.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-onetime');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-onetime' } });
      expect(journalRow.status).toBe('PROCESSED');

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', storeTransactionId: orderId } });
      expect(transaction).toMatchObject({ customerId: customer.id, storeProductId: 'coins_100', subscriptionId: null });

      expect(await prisma.subscription.count({ where: { projectId } })).toBe(0);
    });
  });

  describe('missing/failed authoritative fetch', () => {
    it('journals FAILED (replayable) and never rejects — still 200 at the handler boundary', async () => {
      const throwingClient: StoreClient = {
        getSubscriptionV2: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
        getProduct: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
        revokeAndRefundSubscription: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
      };
      const failingService = new GoogleIngestService(prisma as never, journal, customersService, throwingClient);
      const notification = subscriptionNotification(randomUUID(), 4);

      await expect(failingService.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-failed')).resolves.toBeUndefined();

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-failed' } });
      expect(journalRow.status).toBe('FAILED');
      expect(journalRow.error).toContain('credentials');
    });

    it('a 404 (fetch resolves null) journals SKIPPED with a note rather than FAILED', async () => {
      const notification = subscriptionNotification(randomUUID(), 4); // never seeded — InMemoryStoreClient returns null

      await service.handleDeveloperNotification(notification, { id: appId, projectId }, 'msg-404');

      const journalRow = await prisma.storeNotification.findFirstOrThrow({ where: { storeEventId: 'msg-404' } });
      expect(journalRow.status).toBe('SKIPPED');
      expect(journalRow.error).toContain('404');
    });
  });

  describe('purchaseToken rotation (linkedPurchaseToken)', () => {
    it('re-keys the existing Subscription row to the new token rather than creating a duplicate', async () => {
      const token = randomUUID();
      const customer = await bindCustomer('rotate-user', token);
      const oldToken = randomUUID();
      const newToken = randomUUID();

      storeClient.seedSubscription(
        PACKAGE_NAME,
        oldToken,
        fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }),
      );
      await service.handleDeveloperNotification(subscriptionNotification(oldToken, 4), { id: appId, projectId }, 'msg-rotate-init');

      const before = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken: oldToken } });

      storeClient.seedSubscription(
        PACKAGE_NAME,
        newToken,
        fetchedSubscription({
          linkedPurchaseToken: oldToken,
          latestOrderId: `GPA.${randomUUID()}`,
          lineItems: [
            { productId: 'com.myampix.premium.annual', expiryTime: '2027-07-15T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } },
          ],
          externalAccountIdentifiers: { obfuscatedExternalAccountId: token },
        }),
      );
      await service.handleDeveloperNotification(
        subscriptionNotification(newToken, 4, '2026-07-20T00:00:00Z'),
        { id: appId, projectId },
        'msg-rotate-upgrade',
      );

      const rows = await prisma.subscription.findMany({ where: { projectId, store: 'PLAY_STORE' } });
      expect(rows).toHaveLength(1); // re-keyed, not duplicated
      expect(rows[0].id).toBe(before.id);
      expect(rows[0].purchaseToken).toBe(newToken);
      expect(rows[0].storeProductId).toBe('com.myampix.premium.annual');
      expect(rows[0].customerId).toBe(customer.id);
    });
  });
});
