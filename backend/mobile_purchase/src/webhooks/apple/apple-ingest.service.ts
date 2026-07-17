import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreNotificationJournalService } from '../journal/store-notification-journal.service';
import { CustomersService } from '../../customers/services/customers.service';
import { AppsService } from '../../catalog/services/apps.service';
import { JournalStatus, Prisma, Store } from '../../../generated/client';
import type { VerifiedAppleNotification } from './apple-notification-verifier';
import { appleNotificationToEvent } from '../../subscriptions/lifecycle/apple-notification-mapper';
import { persistLifecycleEvent, type ResolvedApp, type TransactionFacts } from '../shared/persist-lifecycle-event';
import { mapAppleEnvironment, mapAppleTransactionType, mapOwnershipType } from './apple-ingest.mappings';

/**
 * M2b: the Apple ingest BUSINESS pipeline — journal-first record, App-by-bundleId resolution,
 * running the verified notification through the M4a state machine, persisting
 * Subscription/Transaction, and `appAccountToken` customer self-attribution with unlinked-replay
 * deferral (design §1.1/§2/§5/§7).
 *
 * `handleVerifiedAppleNotification` is the controller's entry point for a *fresh* webhook
 * delivery: it inserts the journal row (deduping on `[store, storeEventId]` — design §7) then
 * calls `processJournaledNotification`. That second method is deliberately its own re-runnable
 * unit — it never calls `journal.record` — so M5's future unlinked-replay loop can call it
 * directly against an already-existing UNLINKED/FAILED journal row (reusing that row's stored
 * `payload` as the `VerifiedAppleNotification`) without tripping the journal's own uniqueness
 * constraint the way calling `handleVerifiedAppleNotification` again would.
 */
@Injectable()
export class AppleIngestService {
  private readonly logger = new Logger(AppleIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: StoreNotificationJournalService,
    private readonly customers: CustomersService,
    private readonly apps: AppsService,
  ) {}

  async handleVerifiedAppleNotification(decoded: VerifiedAppleNotification): Promise<void> {
    const app = await this.apps.findByBundleId(decoded.bundleId);
    if (!app) {
      // design §1.1: unknown bundleId -> journal SKIPPED (audit), 200. A duplicate delivery of an
      // already-skipped notification hits the journal's unique constraint and is silently
      // absorbed by `record`'s own idempotent-no-op handling — nothing further to do either way.
      await this.journal.record({
        store: Store.APP_STORE,
        storeEventId: decoded.notificationUUID,
        notificationType: decoded.notificationType,
        subtype: decoded.subtype,
        payload: toJsonPayload(decoded),
        status: JournalStatus.SKIPPED,
      });
      return;
    }

    const journalRow = await this.journal.record({
      store: Store.APP_STORE,
      storeEventId: decoded.notificationUUID,
      notificationType: decoded.notificationType,
      subtype: decoded.subtype,
      projectId: app.projectId,
      appId: app.id,
      payload: toJsonPayload(decoded),
    });
    if (!journalRow) return; // duplicate delivery (same notificationUUID) — idempotent no-op, do NOT reprocess

    await this.processJournaledNotification(journalRow.id, app, decoded);
  }

  /**
   * The re-runnable core: resolves the customer, then hands off to the shared, store-agnostic
   * persistence core (`persistLifecycleEvent`, M3b extraction of what used to be this method's own
   * body) — upsert Transaction (always, once we have transaction facts — RC records revenue
   * immediately, even before a customer link exists), then run the M4a state machine and upsert the
   * Subscription only when a customer is resolved (`Subscription.customerId` is required — it
   * cannot be created unlinked). Never throws: any failure is caught and journaled FAILED
   * (replayable) — a verified, journaled notification is always 200 (design §1.1/§7), and the
   * controller relies on that.
   */
  async processJournaledNotification(journalRowId: string, app: ResolvedApp, decoded: VerifiedAppleNotification): Promise<void> {
    try {
      const event = appleNotificationToEvent(decoded);

      // CONSUMPTION_REQUEST/TEST/REFUND_DECLINED/an unrecognized (sub)type — design §1.1: journal
      // only, no Transaction/Subscription side effects, even when the notification happens to
      // carry transaction info (CONSUMPTION_REQUEST does). Checked here (not left to
      // `persistLifecycleEvent`'s own NO_OP branch) because the "no transaction info" throw below
      // must NOT fire for these — Apple's TEST notification carries no transaction at all.
      if (event.type === 'NO_OP') {
        await this.journal.markProcessed(journalRowId);
        return;
      }

      const transaction = decoded.transaction;
      if (!transaction) {
        // Every real (non-NO_OP) ASSN v2 notification carries signedTransactionInfo, which M2a's
        // verifier assembles whenever Apple sends it. Reaching here with none is a genuine defect
        // — fail closed (caught below, journaled FAILED, replayable) rather than silently skip
        // persistence for an event that claims a real lifecycle effect.
        throw new Error(
          `processJournaledNotification: notificationType "${decoded.notificationType}" (event ${event.type}) carries no transaction info`,
        );
      }

      const token = transaction.appAccountToken;
      const customer = token ? await this.customers.findByStoreToken(app.projectId, Store.APP_STORE, token) : null;

      const transactionFacts: TransactionFacts = {
        storeTransactionId: transaction.transactionId,
        originalTransactionId: transaction.originalTransactionId,
        storeProductId: transaction.productId,
        type: mapAppleTransactionType(transaction.type),
        purchasedAt: transaction.purchaseDate,
        expiresAt: transaction.expiresDate ?? null,
        priceCents: transaction.price ?? null,
        currency: transaction.currency ?? null,
        revokedAt: transaction.revocationDate ?? null,
        rawPayload: toJsonPayload(decoded),
      };

      await persistLifecycleEvent({
        prisma: this.prisma,
        journal: this.journal,
        journalRowId,
        app,
        store: Store.APP_STORE,
        environment: mapAppleEnvironment(decoded.environment),
        event,
        customerId: customer?.id ?? null,
        transactionFacts,
        subscriptionIdentity: { kind: 'originalTransactionId', value: transaction.originalTransactionId },
        ownershipType: mapOwnershipType(transaction.inAppOwnershipType),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Apple notification journal row ${journalRowId} failed processing (replayable): ${message}`);
      await this.journal.markFailed(journalRowId, message);
    }
  }
}

/** Normalizes a decoded notification to a plain-JSON value (Dates -> ISO strings, `undefined`
 * fields dropped) before handing it to a Prisma `Json` column — matches exactly what ends up
 * stored, rather than relying on Prisma's internal Date handling for nested Json values. */
function toJsonPayload(decoded: VerifiedAppleNotification): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(decoded)) as Prisma.InputJsonValue;
}
