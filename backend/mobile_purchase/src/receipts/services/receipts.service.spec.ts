import { randomUUID } from 'node:crypto';
import { VerificationException, VerificationStatus } from '@apple/app-store-server-library';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { ReceiptsService } from './receipts.service';
import { StoreNotificationJournalService } from '../../webhooks/journal/store-notification-journal.service';
import { CustomersService } from '../../customers/services/customers.service';
import { AppsService } from '../../catalog/services/apps.service';
import { AppleNotificationVerifier, type AppleVerifierLike } from '../../webhooks/apple/apple-notification-verifier';
import { AppleIngestService } from '../../webhooks/apple/apple-ingest.service';
import { GoogleIngestService } from '../../webhooks/google/google-ingest.service';
import { InMemoryStoreClient } from '../../webhooks/google/store-client.in-memory';
import { GoogleCredentialsUnavailableError } from '../../webhooks/google/store-client.google-api';
import type { GoogleSubscriptionV2, StoreClient } from '../../webhooks/google/store-client';
import { EntitlementMapService } from '../../subscribers/services/entitlement-map.service';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';

jest.setTimeout(180000);

const PACKAGE_NAME = 'com.myampix.app';

function txnJwsPayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: randomUUID(),
    originalTransactionId: randomUUID(),
    productId: 'com.myampix.premium.monthly',
    type: 'Auto-Renewable Subscription',
    purchaseDate: Date.parse('2026-07-15T00:00:00Z'),
    expiresDate: Date.parse('2026-08-15T00:00:00Z'),
    inAppOwnershipType: 'PURCHASED',
    appAccountToken: undefined,
    offerType: undefined,
    offerDiscountType: undefined,
    revocationDate: undefined,
    price: 9990,
    currency: 'USD',
    environment: 'Sandbox',
    ...overrides,
  };
}

function appleVerifierWith(payload: Record<string, unknown> | Error): AppleNotificationVerifier {
  const verifyAndDecodeTransaction = payload instanceof Error ? jest.fn().mockRejectedValue(payload) : jest.fn().mockResolvedValue(payload);
  const fake: AppleVerifierLike = {
    verifyAndDecodeNotification: jest.fn(),
    verifyAndDecodeTransaction,
    verifyAndDecodeRenewalInfo: jest.fn(),
  };
  return new AppleNotificationVerifier([fake]);
}

function fetchedSubscription(overrides: Partial<GoogleSubscriptionV2> = {}): GoogleSubscriptionV2 {
  return {
    kind: 'androidpublisher#subscriptionPurchaseV2',
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    latestOrderId: `GPA.${randomUUID()}`,
    lineItems: [
      { productId: 'com.myampix.premium.monthly', expiryTime: '2026-08-15T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } },
    ],
    ...overrides,
  };
}

describe('ReceiptsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let journal: StoreNotificationJournalService;
  let customersService: CustomersService;
  let appsService: AppsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    journal = new StoreNotificationJournalService(prisma as never);
    customersService = new CustomersService(prisma as never);
    appsService = new AppsService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  async function makeService(appleVerifier: AppleNotificationVerifier, googleStoreClient: StoreClient) {
    const appleIngest = new AppleIngestService(prisma as never, journal, customersService, appsService);
    const googleIngest = new GoogleIngestService(prisma as never, journal, customersService, googleStoreClient);
    const assembler = new CustomerInfoAssemblerService(prisma as never, new EntitlementMapService(prisma as never));
    return new ReceiptsService(
      prisma as never,
      appsService,
      customersService,
      journal,
      appleVerifier,
      appleIngest,
      googleIngest,
      googleStoreClient,
      assembler,
    );
  }

  async function makeIosApp(bundleId = `com.myampix.${randomUUID()}`) {
    return prisma.app.create({
      data: { projectId, name: 'iOS Test App', platform: 'IOS', bundleId, publicSdkKey: `mp_pub_${randomUUID()}` },
    });
  }

  async function makeAndroidApp() {
    return prisma.app.create({
      data: { projectId, name: 'Android Test App', platform: 'ANDROID', packageName: PACKAGE_NAME, publicSdkKey: `mp_pub_${randomUUID()}` },
    });
  }

  async function grantEntitlement(appId: string, storeProductId: string, identifier: string) {
    const product = await prisma.product.create({
      data: { projectId, appId, storeProductId, type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: storeProductId },
    });
    const entitlement = await prisma.entitlement.create({ data: { projectId, identifier, displayName: identifier } });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: entitlement.id } });
  }

  describe('APP_STORE', () => {
    it('a valid signed transaction JWS persists Subscription+Transaction LINKED, binds the token, and CustomerInfo shows the entitlement active immediately (no webhook needed)', async () => {
      const app = await makeIosApp();
      await grantEntitlement(app.id, 'com.myampix.premium.monthly', 'premium');
      const token = randomUUID();
      const originalTransactionId = randomUUID();
      const verifier = appleVerifierWith(txnJwsPayload({ originalTransactionId, transactionId: originalTransactionId, appAccountToken: token }));
      const service = await makeService(verifier, new InMemoryStoreClient());

      const result = await service.submitReceipt(
        { id: app.id, projectId },
        { app_user_id: 'ios-user-1', platform: 'APP_STORE', fetch_token: 'signed-jws' },
        Date.parse('2026-07-15T00:00:00Z'),
      );

      expect(Object.keys(result.entitlements.active)).toEqual(['premium']);

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'APP_STORE', originalTransactionId } });
      expect(subscription.status).toBe('ACTIVE');
      const customer = await prisma.customer.findFirstOrThrow({ where: { projectId, appUserId: 'ios-user-1' } });
      expect(subscription.customerId).toBe(customer.id);
      expect(customer.appleAppAccountToken).toBe(token);

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { projectId, store: 'APP_STORE', storeTransactionId: originalTransactionId } });
      expect(transaction.customerId).toBe(customer.id);
      expect(transaction.subscriptionId).toBe(subscription.id);
    });

    it('a bad signature -> 402, ProblemException, and persists nothing', async () => {
      const app = await makeIosApp();
      const verifier = appleVerifierWith(new VerificationException(VerificationStatus.VERIFICATION_FAILURE));
      const service = await makeService(verifier, new InMemoryStoreClient());

      await expect(
        service.submitReceipt({ id: app.id, projectId }, { app_user_id: 'ios-user-2', platform: 'APP_STORE', fetch_token: 'tampered-jws' }, Date.now()),
      ).rejects.toMatchObject({ problem: { status: 402 } });

      expect(await prisma.transaction.count({ where: { projectId } })).toBe(0);
      expect(await prisma.subscription.count({ where: { projectId } })).toBe(0);
    });
  });

  describe('PLAY_STORE', () => {
    it('a valid subscription purchase persists Subscription+Transaction LINKED, binds the token, and CustomerInfo shows the entitlement active immediately', async () => {
      const app = await makeAndroidApp();
      await grantEntitlement(app.id, 'com.myampix.premium.monthly', 'premium');
      const token = randomUUID();
      const purchaseToken = randomUUID();
      const storeClient = new InMemoryStoreClient();
      storeClient.seedSubscription(PACKAGE_NAME, purchaseToken, fetchedSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: token } }));
      const service = await makeService(appleVerifierWith(txnJwsPayload()), storeClient);

      const result = await service.submitReceipt(
        { id: app.id, projectId },
        { app_user_id: 'android-user-1', platform: 'PLAY_STORE', fetch_token: purchaseToken },
        Date.parse('2026-07-15T00:00:00Z'),
      );

      expect(Object.keys(result.entitlements.active)).toEqual(['premium']);

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'PLAY_STORE', purchaseToken } });
      expect(subscription.status).toBe('ACTIVE');
      const customer = await prisma.customer.findFirstOrThrow({ where: { projectId, appUserId: 'android-user-1' } });
      expect(subscription.customerId).toBe(customer.id);
      expect(customer.googleObfuscatedId).toBe(token);
    });

    it('no purchase found for fetch_token -> 402, persists nothing', async () => {
      const app = await makeAndroidApp();
      const service = await makeService(appleVerifierWith(txnJwsPayload()), new InMemoryStoreClient());

      await expect(
        service.submitReceipt(
          { id: app.id, projectId },
          { app_user_id: 'android-user-2', platform: 'PLAY_STORE', fetch_token: randomUUID() },
          Date.now(),
        ),
      ).rejects.toMatchObject({ problem: { status: 402 } });

      expect(await prisma.transaction.count({ where: { projectId } })).toBe(0);
    });

    it('missing store credentials -> 503', async () => {
      const app = await makeAndroidApp();
      const throwingClient: StoreClient = {
        getSubscriptionV2: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
        getProduct: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
        revokeAndRefundSubscription: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
      };
      const service = await makeService(appleVerifierWith(txnJwsPayload()), throwingClient);

      await expect(
        service.submitReceipt(
          { id: app.id, projectId },
          { app_user_id: 'android-user-3', platform: 'PLAY_STORE', fetch_token: randomUUID() },
          Date.now(),
        ),
      ).rejects.toMatchObject({ problem: { status: 503 } });
    });
  });

  describe('app_user_id validation (design §3)', () => {
    it('a reserved app_user_id -> 400, no Customer/Transaction/Subscription created', async () => {
      const app = await makeIosApp();
      const service = await makeService(appleVerifierWith(txnJwsPayload()), new InMemoryStoreClient());

      await expect(
        service.submitReceipt({ id: app.id, projectId }, { app_user_id: 'null', platform: 'APP_STORE', fetch_token: 'signed-jws' }, Date.now()),
      ).rejects.toMatchObject({ problem: { status: 400 } });

      expect(await prisma.customer.count({ where: { projectId } })).toBe(0);
      expect(await prisma.transaction.count({ where: { projectId } })).toBe(0);
    });
  });

  describe('token uniqueness (M5-REQ-3)', () => {
    it('a second app_user_id binding an already-bound Apple token -> 409, the original binding is untouched', async () => {
      const app = await makeIosApp();
      const token = randomUUID();
      const firstVerifier = appleVerifierWith(txnJwsPayload({ appAccountToken: token }));
      const firstService = await makeService(firstVerifier, new InMemoryStoreClient());
      await firstService.submitReceipt({ id: app.id, projectId }, { app_user_id: 'owner-user', platform: 'APP_STORE', fetch_token: 'jws-1' }, Date.now());

      const secondVerifier = appleVerifierWith(txnJwsPayload({ appAccountToken: token }));
      const secondService = await makeService(secondVerifier, new InMemoryStoreClient());

      await expect(
        secondService.submitReceipt(
          { id: app.id, projectId },
          { app_user_id: 'claimant-user', platform: 'APP_STORE', fetch_token: 'jws-2' },
          Date.now(),
        ),
      ).rejects.toMatchObject({ problem: { status: 409 } });

      const owner = await prisma.customer.findFirstOrThrow({ where: { projectId, appUserId: 'owner-user' } });
      expect(owner.appleAppAccountToken).toBe(token);
      const claimant = await prisma.customer.findFirstOrThrow({ where: { projectId, appUserId: 'claimant-user' } });
      expect(claimant.appleAppAccountToken).toBeNull();
    });
  });
});
