import { randomUUID } from 'node:crypto';
import { PrismaClient, Store } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { ReceiptsService } from './receipts.service';
import { StoreNotificationJournalService } from '../../webhooks/journal/store-notification-journal.service';
import { CustomersService } from '../../customers/services/customers.service';
import { AppsService } from '../../catalog/services/apps.service';
import { AppleNotificationVerifier, type AppleVerifierLike, type VerifiedAppleNotification } from '../../webhooks/apple/apple-notification-verifier';
import { AppleIngestService } from '../../webhooks/apple/apple-ingest.service';
import { GoogleIngestService } from '../../webhooks/google/google-ingest.service';
import { InMemoryStoreClient } from '../../webhooks/google/store-client.in-memory';
import { EntitlementMapService } from '../../subscribers/services/entitlement-map.service';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';

jest.setTimeout(180000);

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
    price: 9990,
    currency: 'USD',
    environment: 'Sandbox',
    ...overrides,
  };
}

function appleVerifierWith(payload: Record<string, unknown>): AppleNotificationVerifier {
  const fake: AppleVerifierLike = {
    verifyAndDecodeNotification: jest.fn(),
    verifyAndDecodeTransaction: jest.fn().mockResolvedValue(payload),
    verifyAndDecodeRenewalInfo: jest.fn(),
  };
  return new AppleNotificationVerifier([fake]);
}

/** M2b-shaped notification fixture, matching apple-ingest.service.spec.ts's own conventions —
 * used here to seed webhook-originated journal rows/Transactions directly via AppleIngestService,
 * simulating a real ASSN v2 delivery that arrived BEFORE any receipt bound its token. */
function webhookNotification(overrides: Partial<VerifiedAppleNotification> = {}): VerifiedAppleNotification {
  return {
    notificationType: 'SUBSCRIBED',
    subtype: 'INITIAL_BUY',
    notificationUUID: randomUUID(),
    signedDate: new Date('2026-07-10T00:00:00Z'),
    bundleId: 'com.myampix.app',
    environment: 'Sandbox',
    ...overrides,
  };
}

describe('ReceiptsService — unlinked replay, date-rehydration, and receipt/webhook idempotency', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let journal: StoreNotificationJournalService;
  let customersService: CustomersService;
  let appsService: AppsService;
  let appleIngest: AppleIngestService;
  let projectId: string;
  let bundleId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    journal = new StoreNotificationJournalService(prisma as never);
    customersService = new CustomersService(prisma as never);
    appsService = new AppsService(prisma as never);
    appleIngest = new AppleIngestService(prisma as never, journal, customersService, appsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  let appId: string;

  beforeEach(async () => {
    projectId = randomUUID();
    bundleId = `com.myampix.${randomUUID()}`;
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS Test App', platform: 'IOS', bundleId, publicSdkKey: `mp_pub_${randomUUID()}` },
    });
    appId = app.id;
  });

  function makeReceiptsService(verifier: AppleNotificationVerifier): ReceiptsService {
    const googleIngest = new GoogleIngestService(prisma as never, journal, customersService, new InMemoryStoreClient());
    const assembler = new CustomerInfoAssemblerService(prisma as never, new EntitlementMapService(prisma as never));
    return new ReceiptsService(
      prisma as never,
      appsService,
      customersService,
      journal,
      verifier,
      appleIngest,
      googleIngest,
      new InMemoryStoreClient(),
      assembler,
    );
  }

  async function grantEntitlement(storeProductId: string, identifier: string) {
    const product = await prisma.product.create({
      data: { projectId, appId, storeProductId, type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: storeProductId },
    });
    const entitlement = await prisma.entitlement.create({ data: { projectId, identifier, displayName: identifier } });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: entitlement.id } });
  }

  it('headline: a webhook lands UNLINKED before /v1/receipts binds the matching token; replay resolves it and CustomerInfo reflects the previously-orphaned subscription', async () => {
    await grantEntitlement('com.myampix.premium.annual', 'premium-annual');
    await grantEntitlement('com.myampix.premium.monthly', 'premium-monthly');
    const token = randomUUID();
    const webhookOriginalTxnId = randomUUID();

    await appleIngest.handleVerifiedAppleNotification(
      webhookNotification({
        bundleId,
        transaction: {
          transactionId: webhookOriginalTxnId,
          originalTransactionId: webhookOriginalTxnId,
          productId: 'com.myampix.premium.annual',
          purchaseDate: new Date('2026-07-10T00:00:00Z'),
          expiresDate: new Date('2027-07-10T00:00:00Z'),
          type: 'Auto-Renewable Subscription',
          appAccountToken: token,
        },
      }),
    );

    const webhookJournalBefore = await prisma.storeNotification.findFirstOrThrow({ where: { projectId } });
    expect(webhookJournalBefore.status).toBe('UNLINKED');
    const orphanedTransactionBefore = await prisma.transaction.findFirstOrThrow({ where: { projectId, storeTransactionId: webhookOriginalTxnId } });
    expect(orphanedTransactionBefore.customerId).toBeNull();
    expect(await prisma.subscription.count({ where: { projectId } })).toBe(0);

    const receiptOriginalTxnId = randomUUID();
    const verifier = appleVerifierWith(
      txnJwsPayload({ originalTransactionId: receiptOriginalTxnId, transactionId: receiptOriginalTxnId, appAccountToken: token, productId: 'com.myampix.premium.monthly' }),
    );
    const service = makeReceiptsService(verifier);

    const result = await service.submitReceipt(
      { id: appId, projectId },
      { app_user_id: 'headline-user', platform: 'APP_STORE', fetch_token: 'signed-jws' },
      Date.parse('2026-07-15T00:00:00Z'),
    );

    const customer = await prisma.customer.findFirstOrThrow({ where: { projectId, appUserId: 'headline-user' } });
    expect(customer.appleAppAccountToken).toBe(token);

    // the receipt's OWN purchase resolves LINKED immediately.
    const receiptSubscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, originalTransactionId: receiptOriginalTxnId } });
    expect(receiptSubscription.customerId).toBe(customer.id);

    // the PREVIOUSLY-ORPHANED webhook purchase is now resolved too, via replay.
    const webhookJournalAfter = await prisma.storeNotification.findUniqueOrThrow({ where: { id: webhookJournalBefore.id } });
    expect(webhookJournalAfter.status).toBe('PROCESSED');
    const webhookSubscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, originalTransactionId: webhookOriginalTxnId } });
    expect(webhookSubscription.customerId).toBe(customer.id);
    const orphanedTransactionAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: orphanedTransactionBefore.id } });
    expect(orphanedTransactionAfter.customerId).toBe(customer.id);

    // CustomerInfo — returned by THIS SAME receipt call — reflects BOTH subscriptions.
    expect(result.subscriptions).toHaveLength(2);
    expect(result.subscriptions.map((s) => s.storeProductId).sort()).toEqual(['com.myampix.premium.annual', 'com.myampix.premium.monthly']);
    expect(Object.keys(result.entitlements.active).sort()).toEqual(['premium-annual', 'premium-monthly']);
  });

  it('date-rehydration: replaying a raw (un-rehydrated) row against an existing Subscription fails; ReceiptsService (which rehydrates) resolves it correctly', async () => {
    const token = randomUUID();
    const originalTransactionId = randomUUID();

    await appleIngest.handleVerifiedAppleNotification(
      webhookNotification({
        bundleId,
        signedDate: new Date('2026-07-15T00:00:00Z'),
        transaction: {
          transactionId: randomUUID(),
          originalTransactionId,
          productId: 'com.myampix.premium.monthly',
          purchaseDate: new Date('2026-07-15T00:00:00Z'),
          expiresDate: new Date('2026-08-15T00:00:00Z'),
          type: 'Auto-Renewable Subscription',
          appAccountToken: token,
        },
      }),
    );
    await appleIngest.handleVerifiedAppleNotification(
      webhookNotification({
        bundleId,
        notificationType: 'DID_RENEW',
        subtype: undefined,
        signedDate: new Date('2026-08-15T00:10:00Z'),
        transaction: {
          transactionId: randomUUID(),
          originalTransactionId,
          productId: 'com.myampix.premium.monthly',
          purchaseDate: new Date('2026-08-15T00:00:00Z'),
          expiresDate: new Date('2026-09-15T00:00:00Z'),
          type: 'Auto-Renewable Subscription',
          appAccountToken: token,
        },
      }),
    );

    const rowsBefore = await prisma.storeNotification.findMany({ where: { projectId, status: 'UNLINKED' }, orderBy: { receivedAt: 'asc' } });
    expect(rowsBefore).toHaveLength(2);
    // Sanity: once round-tripped through Postgres's Json column, the stored payload's Date fields
    // really are ISO strings, not Date instances — exactly what M5-REQ-2 requires rehydrating.
    expect(typeof (rowsBefore[0].payload as { signedDate: unknown }).signedDate).toBe('string');

    // Simulate "the customer is now known" directly (what a bind normally does) so the raw replay
    // below actually reaches the reducer instead of short-circuiting to UNLINKED again for lack of
    // a customer — same app_user_id the ReceiptsService call below uses, so its own bind is a
    // no-op and does not conflict with this one.
    const preboundCustomer = await customersService.getOrCreateCustomer(projectId, 'rehydrate-user');
    await customersService.bindStoreToken(projectId, preboundCustomer.id, Store.APP_STORE, token);

    // WITHOUT rehydration: replay both rows raw, oldest first (matching listUnlinkedForReplay's
    // own ordering). AppleIngestService never throws (it catches and journals FAILED) — the
    // renewal, which must compare against the already-persisted Subscription's lastEventAt via
    // the reducer's ordering guard (a genuine `.getTime()` call on the event's own occurredAt),
    // ends up FAILED rather than PROCESSED — concrete proof of the claim.
    for (const row of rowsBefore) {
      await appleIngest.processJournaledNotification(row.id, { id: appId, projectId }, row.payload as never);
    }
    const renewalRowAfterRaw = await prisma.storeNotification.findUniqueOrThrow({ where: { id: rowsBefore[1].id } });
    expect(renewalRowAfterRaw.status).toBe('FAILED');

    // WITH rehydration, via ReceiptsService.submitReceipt binding the same token: replay
    // reconstructs real Date instances for whichever row(s) are still UNLINKED/FAILED and
    // resolves them in order — the Subscription ends up reflecting the RENEWAL's extended expiry,
    // not just the initial purchase's.
    const verifier = appleVerifierWith(txnJwsPayload({ appAccountToken: token, productId: 'com.myampix.premium.annual' }));
    const service = makeReceiptsService(verifier);
    await service.submitReceipt({ id: appId, projectId }, { app_user_id: 'rehydrate-user', platform: 'APP_STORE', fetch_token: 'jws' }, Date.now());

    const finalRows = await prisma.storeNotification.findMany({ where: { id: { in: rowsBefore.map((r) => r.id) } } });
    expect(finalRows.every((r) => r.status === 'PROCESSED')).toBe(true);

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, store: 'APP_STORE', originalTransactionId } });
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.expiresAt).toEqual(new Date('2026-09-15T00:00:00Z'));
    const customer = await prisma.customer.findFirstOrThrow({ where: { projectId, appUserId: 'rehydrate-user' } });
    expect(subscription.customerId).toBe(customer.id);
  });

  it('idempotency: a receipt then a webhook for the SAME purchase does not duplicate the Transaction/Subscription', async () => {
    const token = randomUUID();
    const originalTransactionId = randomUUID();
    const purchaseDate = new Date('2026-07-15T00:00:00Z');
    const expiresDate = new Date('2026-08-15T00:00:00Z');

    // the receipt arrives FIRST (the headline SDK-first path).
    const verifier = appleVerifierWith(
      txnJwsPayload({
        originalTransactionId,
        transactionId: originalTransactionId,
        appAccountToken: token,
        purchaseDate: purchaseDate.getTime(),
        expiresDate: expiresDate.getTime(),
      }),
    );
    const service = makeReceiptsService(verifier);
    await service.submitReceipt({ id: appId, projectId }, { app_user_id: 'idempotency-user', platform: 'APP_STORE', fetch_token: 'signed-jws' }, purchaseDate.getTime());

    expect(await prisma.transaction.count({ where: { projectId, originalTransactionId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { projectId, originalTransactionId } })).toBe(1);

    // Apple's OWN webhook for the SAME transaction arrives afterward (a real ASSN notification —
    // distinct notificationUUID, same transactionId/token, already bound by the receipt above).
    await appleIngest.handleVerifiedAppleNotification(
      webhookNotification({
        bundleId,
        signedDate: purchaseDate,
        transaction: {
          transactionId: originalTransactionId,
          originalTransactionId,
          productId: 'com.myampix.premium.monthly',
          purchaseDate,
          expiresDate,
          type: 'Auto-Renewable Subscription',
          appAccountToken: token,
        },
      }),
    );

    expect(await prisma.transaction.count({ where: { projectId, originalTransactionId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { projectId, originalTransactionId } })).toBe(1);
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { projectId, originalTransactionId } });
    expect(subscription.status).toBe('ACTIVE');
  });

  it('cross-customer isolation: binding one token replays only that token\'s UNLINKED webhook; a different customer\'s row stays UNLINKED', async () => {
    const tokenA = randomUUID();
    const tokenB = randomUUID();
    const txnA = randomUUID();
    const txnB = randomUUID();

    // two webhooks land UNLINKED, for two different (future) customers, distinguished only by token.
    for (const [token, txn] of [[tokenA, txnA], [tokenB, txnB]] as const) {
      await appleIngest.handleVerifiedAppleNotification(
        webhookNotification({
          bundleId,
          transaction: {
            transactionId: txn,
            originalTransactionId: txn,
            productId: 'com.myampix.premium.monthly',
            purchaseDate: new Date('2026-07-10T00:00:00Z'),
            expiresDate: new Date('2027-07-10T00:00:00Z'),
            type: 'Auto-Renewable Subscription',
            appAccountToken: token,
          },
        }),
      );
    }
    expect(await prisma.storeNotification.count({ where: { projectId, status: 'UNLINKED' } })).toBe(2);

    // a receipt binds ONLY tokenA.
    const receiptTxn = randomUUID();
    const verifier = appleVerifierWith(txnJwsPayload({ originalTransactionId: receiptTxn, transactionId: receiptTxn, appAccountToken: tokenA }));
    await makeReceiptsService(verifier).submitReceipt(
      { id: appId, projectId },
      { app_user_id: 'cust-a', platform: 'APP_STORE', fetch_token: 'jws' },
      Date.now(),
    );

    // tokenA's purchase is resolved (linked + Subscription created); tokenB's is untouched.
    expect((await prisma.transaction.findFirstOrThrow({ where: { projectId, storeTransactionId: txnA } })).customerId).not.toBeNull();
    expect((await prisma.transaction.findFirstOrThrow({ where: { projectId, storeTransactionId: txnB } })).customerId).toBeNull();
    expect(await prisma.subscription.count({ where: { projectId, originalTransactionId: txnA } })).toBe(1);
    expect(await prisma.subscription.count({ where: { projectId, originalTransactionId: txnB } })).toBe(0);
    // only tokenB's webhook row remains UNLINKED (tokenA's -> PROCESSED, the receipt's own -> PROCESSED).
    expect(await prisma.storeNotification.count({ where: { projectId, status: 'UNLINKED' } })).toBe(1);
  });

  it('receipt-origin journal rows are never swept by webhook replay (regression: a failed receipt must not be masked PROCESSED)', async () => {
    const token = randomUUID();
    const orphanTxn = randomUUID();

    // Simulate a receipt whose synchronous persist had thrown: a provisional FAILED, receipt-origin
    // journal row survives, carrying the matching appAccountToken but NO notificationType.
    const seeded = await journal.record({
      store: Store.APP_STORE,
      storeEventId: orphanTxn,
      notificationType: 'receipt',
      projectId,
      appId,
      payload: { source: 'receipt', transaction: { appAccountToken: token, transactionId: orphanTxn, originalTransactionId: orphanTxn } },
      // status defaults to the provisional FAILED.
    });
    expect(seeded).not.toBeNull();

    // a later receipt binds the SAME token and triggers replay for it.
    const receiptTxn = randomUUID();
    const verifier = appleVerifierWith(txnJwsPayload({ originalTransactionId: receiptTxn, transactionId: receiptTxn, appAccountToken: token }));
    await makeReceiptsService(verifier).submitReceipt(
      { id: appId, projectId },
      { app_user_id: 'skip-user', platform: 'APP_STORE', fetch_token: 'jws' },
      Date.now(),
    );

    // the receipt-origin row must NOT be swept to PROCESSED (the bug: NO_OP -> markProcessed masking a
    // failed purchase); it stays FAILED, and no Subscription is fabricated from it.
    const seededAfter = await prisma.storeNotification.findUniqueOrThrow({ where: { id: seeded!.id } });
    expect(seededAfter.status).toBe('FAILED');
    expect(await prisma.subscription.count({ where: { projectId, originalTransactionId: orphanTxn } })).toBe(0);
  });
});
