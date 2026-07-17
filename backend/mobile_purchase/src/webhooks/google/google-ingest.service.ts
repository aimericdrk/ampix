import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreNotificationJournalService } from '../journal/store-notification-journal.service';
import { CustomersService } from '../../customers/services/customers.service';
import { Environment, JournalStatus, Prisma, ProductType, Store } from '../../../generated/client';
import type {
  DeveloperNotification,
  GoogleOneTimeProductNotificationPayload,
  GoogleSubscriptionNotificationPayload,
  GoogleVoidedPurchaseNotificationPayload,
} from './google-notification-envelope';
import { googleNotificationToEvent, type GoogleSubscriptionFacts } from '../../subscriptions/lifecycle/google-notification-mapper';
import type { SubscriptionLifecycleEvent } from '../../subscriptions/lifecycle/subscription-lifecycle.types';
import {
  applySubscriptionLifecycle,
  persistLifecycleEvent,
  subscriptionIdentityWhere,
  upsertLifecycleTransaction,
  type ResolvedApp,
  type TransactionFacts,
} from '../shared/persist-lifecycle-event';
import { GOOGLE_STORE_CLIENT } from './google-store-client.factory';
import type { GoogleSubscriptionLineItem, GoogleSubscriptionV2, StoreClient } from './store-client';

/** Google's Play Developer API has no Apple-style Sandbox/Production split for
 * `subscriptionsv2.get` responses (license testers transact through the same production
 * infrastructure real users do) — every Google `Subscription`/`Transaction` row is recorded as
 * `PRODUCTION`. Documented default, not an oversight. */
const GOOGLE_ENVIRONMENT = Environment.PRODUCTION;

/**
 * M3b: the Google ingest BUSINESS pipeline — the Google counterpart of `AppleIngestService`
 * (design §1.2/§2/§7). The key twist vs. Apple: RTDN carries NO state, only a trigger +
 * `purchaseToken` — `subscriptionNotification` handling re-fetches the AUTHORITATIVE
 * `SubscriptionPurchaseV2` via `StoreClient.getSubscriptionV2` before running the M4a state
 * machine, so out-of-order delivery self-heals (the fetch always reflects current truth regardless
 * of which notification triggered it).
 *
 * `handleDeveloperNotification` is the controller's entry point for a *fresh* Pub/Sub delivery: it
 * inserts the journal row (deduping on `[store, storeEventId=messageId]` — design §7) then calls
 * `processJournaledNotification`, which never calls `journal.record` — same re-runnable-core shape
 * as `AppleIngestService.processJournaledNotification`, so a future M5 replay loop can call it
 * directly against an existing UNLINKED/FAILED journal row.
 */
@Injectable()
export class GoogleIngestService {
  private readonly logger = new Logger(GoogleIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: StoreNotificationJournalService,
    private readonly customers: CustomersService,
    @Inject(GOOGLE_STORE_CLIENT) private readonly storeClient: StoreClient,
  ) {}

  async handleDeveloperNotification(notification: DeveloperNotification, app: ResolvedApp | null, messageId: string): Promise<void> {
    const { type, subtype } = notificationTypeLabel(notification);
    const payload = toJsonPayload(notification);

    if (!app) {
      // design §1.2: unknown packageName -> journal SKIPPED (audit), 200. A duplicate delivery of
      // an already-skipped notification hits the journal's unique constraint and is silently
      // absorbed by `record`'s own idempotent-no-op handling — nothing further to do either way.
      await this.journal.record({
        store: Store.PLAY_STORE,
        storeEventId: messageId,
        notificationType: type,
        subtype,
        payload,
        status: JournalStatus.SKIPPED,
      });
      return;
    }

    const journalRow = await this.journal.record({
      store: Store.PLAY_STORE,
      storeEventId: messageId,
      notificationType: type,
      subtype,
      projectId: app.projectId,
      appId: app.id,
      payload,
    });
    if (!journalRow) return; // duplicate delivery (same messageId) — idempotent no-op, do NOT reprocess

    await this.processJournaledNotification(journalRow.id, app, notification);
  }

  /**
   * The re-runnable core. Never throws: any failure (including a missing/failed authoritative
   * fetch — missing `App.storeCredentials`, transport error) is caught and journaled FAILED
   * (replayable) — a verified, journaled notification is always 200 (design §1.2/§7), and the
   * controller relies on that.
   */
  async processJournaledNotification(journalRowId: string, app: ResolvedApp, notification: DeveloperNotification): Promise<void> {
    try {
      const eventTimeMillis = Number(notification.eventTimeMillis);

      if (notification.testNotification) {
        // design §1.2: journal only, no-op. No purchaseToken to fetch with at all.
        await this.journal.markProcessed(journalRowId);
        return;
      }

      if (notification.subscriptionNotification) {
        await this.handleSubscriptionNotification(journalRowId, app, notification.packageName, notification.subscriptionNotification, eventTimeMillis);
        return;
      }

      if (notification.voidedPurchaseNotification) {
        await this.handleVoidedPurchaseNotification(journalRowId, app, notification.voidedPurchaseNotification, eventTimeMillis);
        return;
      }

      if (notification.oneTimeProductNotification) {
        await this.handleOneTimeProductNotification(
          journalRowId,
          app,
          notification.packageName,
          notification.oneTimeProductNotification,
          eventTimeMillis,
        );
        return;
      }

      // Unreachable via decodeDeveloperNotification's own schema (requires one recognized kind) —
      // guarded for callers that construct a DeveloperNotification directly (tests, or a future
      // forward-compat replay of an old journal payload).
      await this.journal.markProcessed(journalRowId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Google notification journal row ${journalRowId} failed processing (replayable): ${message}`);
      await this.journal.markFailed(journalRowId, message);
    }
  }

  /**
   * design §1.2 "Authoritative state fetch (hard dependency)": RTDN carries no state, so every
   * `subscriptionNotification` — regardless of its `notificationType` — re-fetches
   * `subscriptionsv2.get` before deciding anything. That fetch is also the ONLY source of the
   * customer link (`externalAccountIdentifiers.obfuscatedExternalAccountId`), so even
   * notification types whose mapped event needs no `facts` (e.g. `PAUSE_SCHEDULE_CHANGED`) still
   * go through it, for uniformity and correct attribution.
   */
  private async handleSubscriptionNotification(
    journalRowId: string,
    app: ResolvedApp,
    packageName: string,
    payload: GoogleSubscriptionNotificationPayload,
    eventTimeMillis: number,
  ): Promise<void> {
    const fetched = await this.storeClient.getSubscriptionV2(packageName, payload.purchaseToken);

    if (!fetched) {
      // design §1.2: fetch returns null (404, purchase gone) -> no state to apply. SKIPPED (with a
      // reason) rather than PROCESSED — nothing was actually processed.
      await this.journal.markSkipped(
        journalRowId,
        `Google subscriptionsv2.get returned no purchase for purchaseToken "${payload.purchaseToken}" (404) — nothing to apply`,
      );
      return;
    }

    const lineItem = fetched.lineItems[0];
    if (!lineItem) {
      throw new Error(
        `Google subscriptionsv2.get for purchaseToken "${payload.purchaseToken}" returned no lineItems — cannot resolve subscription facts`,
      );
    }

    const facts = toGoogleSubscriptionFacts(lineItem);
    const event = googleNotificationToEvent({
      kind: 'subscription',
      notificationType: payload.notificationType,
      eventTimeMillis,
      facts,
    });

    if (event.type === 'NO_OP') {
      // e.g. PAUSE_SCHEDULE_CHANGED/PENDING_PURCHASE_CANCELED/an unrecognized type — journal only.
      await this.journal.markProcessed(journalRowId);
      return;
    }

    const customerToken = fetched.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    const customer = customerToken ? await this.customers.findByStoreToken(app.projectId, Store.PLAY_STORE, customerToken) : null;
    const customerId = customer?.id ?? null;

    // Only a genuine financial event creates a new Transaction (design §1.2's per-type table names
    // "Transaction" for RENEWED/PURCHASED only) — status-only transitions (CANCELED, ON_HOLD,
    // RECOVERED, RESTARTED, PAUSED, EXPIRED, REVOKED-via-subscriptionNotification) update only the
    // Subscription.
    const transactionFacts = isRevenueEvent(event) ? buildSubscriptionTransactionFacts(fetched, lineItem, event, packageName) : null;

    const newIdentity = { kind: 'purchaseToken' as const, value: payload.purchaseToken };

    // design §7 "Google token rotation": `linkedPurchaseToken`, when present, is the OLD token
    // this fetch's token superseded (an upgrade/downgrade/resubscribe). If a Subscription row is
    // still keyed under that OLD token, re-key the SAME row to the new token instead of creating a
    // duplicate Subscription for what is, underneath, one continuous purchase.
    const rotatedFrom = fetched.linkedPurchaseToken
      ? await this.prisma.subscription.findUnique({
          where: subscriptionIdentityWhere(app.projectId, Store.PLAY_STORE, { kind: 'purchaseToken', value: fetched.linkedPurchaseToken }),
        })
      : null;

    if (rotatedFrom) {
      let persistedTransaction = null;
      if (transactionFacts) {
        persistedTransaction = await upsertLifecycleTransaction({
          prisma: this.prisma,
          app,
          store: Store.PLAY_STORE,
          environment: GOOGLE_ENVIRONMENT,
          facts: transactionFacts,
          customerId,
        });
      }
      if (!customerId) {
        await this.journal.markUnlinked(journalRowId);
        return;
      }
      const subscription = await applySubscriptionLifecycle({
        prisma: this.prisma,
        app,
        store: Store.PLAY_STORE,
        environment: GOOGLE_ENVIRONMENT,
        event,
        customerId,
        currentRow: rotatedFrom,
        writeIdentity: newIdentity,
      });
      if (subscription && persistedTransaction && persistedTransaction.subscriptionId !== subscription.id) {
        await this.prisma.transaction.update({ where: { id: persistedTransaction.id }, data: { subscriptionId: subscription.id } });
      }
      await this.journal.markProcessed(journalRowId);
      return;
    }

    await persistLifecycleEvent({
      prisma: this.prisma,
      journal: this.journal,
      journalRowId,
      app,
      store: Store.PLAY_STORE,
      environment: GOOGLE_ENVIRONMENT,
      event,
      customerId,
      transactionFacts,
      subscriptionIdentity: newIdentity,
    });
  }

  /**
   * design §1.2: mark the matching Transaction's `revokedAt` (matched by `orderId`, which may
   * legitimately not exist yet — e.g. replay ordering) and, for a subscription (`productType`
   * 1 — one-time products, `productType` 2, have no Subscription row to drive), run the mapper's
   * `voided -> REVOKED` event against the Subscription identified by `purchaseToken`.
   * `refundType` QUANTITY_BASED_REFUND (2) really means a partial-quantity refund on a consumable
   * — not modeled here (flagged): every voided purchase is treated as a full revoke, matching the
   * design table's literal "REVOKED" effect for this row.
   */
  private async handleVoidedPurchaseNotification(
    journalRowId: string,
    app: ResolvedApp,
    payload: GoogleVoidedPurchaseNotificationPayload,
    eventTimeMillis: number,
  ): Promise<void> {
    const event = googleNotificationToEvent({ kind: 'voided', eventTimeMillis, refundType: payload.refundType });
    // event.type is always 'REVOKED' here (see googleNotificationToEvent's 'voided' case).
    const revokedAt = event.type === 'REVOKED' ? (event.revokedAt ?? event.occurredAt) : event.occurredAt;

    await this.prisma.transaction.updateMany({
      where: { projectId: app.projectId, store: Store.PLAY_STORE, storeTransactionId: payload.orderId },
      data: { revokedAt },
    });

    if (payload.productType === 2) {
      // One-time product voided: Transaction-only, no Subscription row exists for it.
      await this.journal.markProcessed(journalRowId);
      return;
    }

    const identity = { kind: 'purchaseToken' as const, value: payload.purchaseToken };
    const currentRow = await this.prisma.subscription.findUnique({ where: subscriptionIdentityWhere(app.projectId, Store.PLAY_STORE, identity) });
    if (!currentRow) {
      // Mirrors the reducer's own fail-closed posture for a state-bearing event with no prior
      // subscription — journal FAILED (replayable) rather than silently no-op.
      throw new Error(`voidedPurchaseNotification: no Subscription found for purchaseToken "${payload.purchaseToken}"`);
    }

    await applySubscriptionLifecycle({
      prisma: this.prisma,
      app,
      store: Store.PLAY_STORE,
      environment: GOOGLE_ENVIRONMENT,
      event,
      customerId: currentRow.customerId,
      currentRow,
      writeIdentity: identity,
    });

    await this.journal.markProcessed(journalRowId);
  }

  /** design §1.2: `purchases.products.get` -> Transaction only (ONE_TIME_CHARGE), no Subscription. */
  private async handleOneTimeProductNotification(
    journalRowId: string,
    app: ResolvedApp,
    packageName: string,
    payload: GoogleOneTimeProductNotificationPayload,
    eventTimeMillis: number,
  ): Promise<void> {
    const fetched = await this.storeClient.getProduct(packageName, payload.sku, payload.purchaseToken);

    if (!fetched) {
      await this.journal.markSkipped(
        journalRowId,
        `Google products.get returned no purchase for purchaseToken "${payload.purchaseToken}" (404) — nothing to apply`,
      );
      return;
    }
    if (!fetched.orderId) {
      throw new Error(`Google products.get for purchaseToken "${payload.purchaseToken}" returned no orderId — cannot build a Transaction`);
    }

    const event = googleNotificationToEvent({ kind: 'one_time', eventTimeMillis, notificationType: payload.notificationType, sku: payload.sku });

    const customerToken = fetched.obfuscatedExternalAccountId;
    const customer = customerToken ? await this.customers.findByStoreToken(app.projectId, Store.PLAY_STORE, customerToken) : null;

    const transactionFacts: TransactionFacts = {
      storeTransactionId: fetched.orderId,
      originalTransactionId: null,
      storeProductId: payload.sku,
      // Play's purchase record doesn't distinguish consumable vs. non-consumable (that's a
      // catalog-level Product configuration, not part of the purchase itself) — default to the
      // option with the fewest lifecycle implications, same rationale as Apple's mapper default.
      type: ProductType.NON_CONSUMABLE,
      purchasedAt: fetched.purchaseTimeMillis ? new Date(Number(fetched.purchaseTimeMillis)) : event.occurredAt,
      expiresAt: null,
      priceCents: null,
      currency: null,
      revokedAt: null,
      rawPayload: toJsonPayload(fetched),
    };

    await persistLifecycleEvent({
      prisma: this.prisma,
      journal: this.journal,
      journalRowId,
      app,
      store: Store.PLAY_STORE,
      environment: GOOGLE_ENVIRONMENT,
      event,
      customerId: customer?.id ?? null,
      transactionFacts,
      subscriptionIdentity: null,
    });
  }
}

/** `INITIAL_PURCHASE`/`RENEWED` are the only events design §1.2's per-type table names a
 * Transaction for. Narrows the union so `buildSubscriptionTransactionFacts` gets a properly-typed
 * event. */
function isRevenueEvent(
  event: SubscriptionLifecycleEvent,
): event is Extract<SubscriptionLifecycleEvent, { type: 'INITIAL_PURCHASE' | 'RENEWED' }> {
  return event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWED';
}

/**
 * Maps `SubscriptionPurchaseV2.lineItems[0]` (design §1.2's named fields:
 * `productId, expiryTime, autoRenewingPlan, offerDetails`) to the M4a mapper's
 * `GoogleSubscriptionFacts`. `subscriptionState`/`latestOrderId`/`externalAccountIdentifiers`/
 * `linkedPurchaseToken` (also design §1.2-named fields of the fetched object) are NOT part of this
 * mapping — they drive, respectively: nothing directly (the mapper's event TYPE comes from the
 * RTDN's own `notificationType`, not the fetched `subscriptionState` — see
 * `google-notification-mapper.ts`'s own docs), the Transaction's `storeTransactionId`, the customer
 * lookup, and the purchaseToken-rotation identity resolution — each handled by the caller directly
 * off the fetched `GoogleSubscriptionV2`, not through this facts object.
 *
 * `isTrial`/`isIntro` (flagged): the modeled `GoogleOfferDetails` shape has no canonical
 * "this is a free trial" boolean — Play's real API doesn't expose one uniformly either; developers
 * choose their own `offerTags`. Best-effort heuristic: an `offerTags` entry containing "trial" ->
 * trial; otherwise a present `offerId` (or an "intro" tag) -> intro; otherwise a normal paid
 * purchase. Revisit once a real Play offer catalog is available to validate against.
 */
function toGoogleSubscriptionFacts(lineItem: GoogleSubscriptionLineItem): GoogleSubscriptionFacts {
  const offerTags = (lineItem.offerDetails?.offerTags ?? []).map((tag) => tag.toLowerCase());
  const isTrial = offerTags.some((tag) => tag.includes('trial'));
  const isIntro = !isTrial && (offerTags.some((tag) => tag.includes('intro')) || Boolean(lineItem.offerDetails?.offerId));

  return {
    productId: lineItem.productId,
    expiryTime: new Date(lineItem.expiryTime),
    autoRenewing: lineItem.autoRenewingPlan?.autoRenewEnabled ?? false,
    isTrial,
    isIntro,
    // Play doesn't surface a grace-period expiry on lineItems in this modeled shape — the M4a
    // mapper already tolerates this (falls back to `null`, not a throw).
    gracePeriodExpiryTime: undefined,
  };
}

/**
 * Builds the Transaction facts for a revenue event (INITIAL_PURCHASE/RENEWED). `purchasedAt` uses
 * the event's own `occurredAt` (the RTDN's `eventTimeMillis`) — unlike Apple, Google's fetched
 * `SubscriptionPurchaseV2` carries no per-renewal purchase timestamp distinct from the overall
 * subscription's `startTime`, so the notification's own event time is the closest available signal
 * for "when this specific charge happened."
 */
function buildSubscriptionTransactionFacts(
  fetched: GoogleSubscriptionV2,
  lineItem: GoogleSubscriptionLineItem,
  event: Extract<SubscriptionLifecycleEvent, { type: 'INITIAL_PURCHASE' | 'RENEWED' }>,
  packageName: string,
): TransactionFacts {
  if (!fetched.latestOrderId) {
    throw new Error(
      `Google subscriptionsv2.get for packageName "${packageName}" returned no latestOrderId — cannot build the Transaction row (storeTransactionId is required)`,
    );
  }
  return {
    storeTransactionId: fetched.latestOrderId,
    // Google has no Apple-style stable "original" id distinct from a rotating purchaseToken
    // (design §7) — left unset rather than approximated with something that could later collide.
    originalTransactionId: null,
    storeProductId: lineItem.productId,
    type: ProductType.AUTO_RENEWABLE_SUBSCRIPTION,
    purchasedAt: event.occurredAt,
    expiresAt: new Date(lineItem.expiryTime),
    priceCents: null,
    currency: null,
    revokedAt: null,
    rawPayload: toJsonPayload(fetched),
  };
}

function notificationTypeLabel(notification: DeveloperNotification): { type: string; subtype?: string } {
  if (notification.testNotification) return { type: 'testNotification' };
  if (notification.subscriptionNotification) {
    return { type: 'subscriptionNotification', subtype: String(notification.subscriptionNotification.notificationType) };
  }
  if (notification.voidedPurchaseNotification) return { type: 'voidedPurchaseNotification' };
  if (notification.oneTimeProductNotification) {
    return { type: 'oneTimeProductNotification', subtype: String(notification.oneTimeProductNotification.notificationType) };
  }
  return { type: 'unknown' };
}

/** Normalizes an arbitrary decoded/fetched value to a plain-JSON value (Dates -> ISO strings,
 * `undefined` fields dropped) before handing it to a Prisma `Json` column — matches
 * `apple-ingest.service.ts`'s `toJsonPayload`, generalized beyond one input type since this module
 * uses it for both the journal's `DeveloperNotification` payload and a Transaction's fetched
 * `rawPayload` (`GoogleSubscriptionV2` / `GoogleOneTimeProductPurchase`). */
function toJsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
