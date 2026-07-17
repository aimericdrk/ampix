import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppsService } from '../../catalog/services/apps.service';
import type { SdkApp } from '../../catalog/public-api-key.guard';
import { CustomersService } from '../../customers/services/customers.service';
import { appReservedStoreIds } from '../../subscribers/support/reserved-store-ids';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';
import type { CustomerInfo } from '../../entitlements/customer-info.types';
import { StoreNotificationJournalService } from '../../webhooks/journal/store-notification-journal.service';
import { AppleNotificationVerifier } from '../../webhooks/apple/apple-notification-verifier';
import { AppleIngestService } from '../../webhooks/apple/apple-ingest.service';
import { GoogleIngestService } from '../../webhooks/google/google-ingest.service';
import { GOOGLE_STORE_CLIENT } from '../../webhooks/google/google-store-client.factory';
import type { StoreClient } from '../../webhooks/google/store-client';
import { persistLifecycleEvent, type ResolvedApp } from '../../webhooks/shared/persist-lifecycle-event';
import type { SubmitReceiptInput } from '../support/receipts.schemas';
import { validateAppleReceipt } from '../support/apple-receipt-validator';
import { validateGoogleReceipt } from '../support/google-receipt-validator';
import { replayUnlinkedForToken } from '../support/unlinked-replay';

/**
 * M5b: `POST /v1/receipts` — synchronous receipt validation, store-token<->customer binding, and
 * unlinked-replay (design §5/§7/§10). The primary attribution path: unlike a webhook, the SDK
 * calls this directly right after a purchase, so this is where the store token gets explicitly
 * bound to `app_user_id` — the bind a webhook arriving first (landing UNLINKED) waits on.
 *
 * Flow (brief's numbered steps, design §5):
 *  1. Load the App's identifiers (reservedStoreIds input).
 *  2. Validate `app_user_id` (§3) — reserved/invalid -> 400, NO writes (enforced by
 *     `getOrCreateCustomer` calling `assertValidAppUserId` before its own upsert).
 *  3. Resolve-or-create the Customer — a LINKED persist (we KNOW the customer from here on).
 *  4. Validate the token against the store (Apple JWS / Google authoritative fetch).
 *  5. Persist via the SAME shared `persistLifecycleEvent` core M2b/M3b use, customer RESOLVED.
 *  6. Bind the store token to the Customer (skipped when the receipt carries none).
 *  7. Replay any UNLINKED/FAILED journal rows for this same purchase.
 *  8. Assemble + return the SAME CustomerInfo shape `GET /v1/subscribers/:appUserId` returns.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apps: AppsService,
    private readonly customers: CustomersService,
    private readonly journal: StoreNotificationJournalService,
    private readonly appleVerifier: AppleNotificationVerifier,
    private readonly appleIngest: AppleIngestService,
    private readonly googleIngest: GoogleIngestService,
    @Inject(GOOGLE_STORE_CLIENT) private readonly googleStoreClient: StoreClient,
    private readonly assembler: CustomerInfoAssemblerService,
  ) {}

  async submitReceipt(sdkApp: SdkApp, input: SubmitReceiptInput, nowMs: number): Promise<CustomerInfo> {
    const appIdentifiers = await this.apps.findIdentifiers(sdkApp.id);
    const reservedStoreIds = appReservedStoreIds(appIdentifiers);

    // Step 2 + 3: reserved/invalid app_user_id -> 400 (assertValidAppUserId runs before any write
    // inside getOrCreateCustomer). From here on the customer is RESOLVED — a LINKED persist.
    const customer = await this.customers.getOrCreateCustomer(sdkApp.projectId, input.app_user_id, reservedStoreIds);

    const resolvedApp: ResolvedApp = { id: sdkApp.id, projectId: sdkApp.projectId };

    // Step 4: validate the token against the store. Apple/Google-specific errors already carry
    // the right ProblemException status (402/503) — nothing to catch here.
    const validated =
      input.platform === 'APP_STORE'
        ? await validateAppleReceipt(this.appleVerifier, input.fetch_token)
        : await validateGoogleReceipt(this.googleStoreClient, appIdentifiers.packageName, input, nowMs);

    // Step 5: journal-first (mirrors the webhook ingest pattern) so persistLifecycleEvent's
    // journal coupling + audit trail apply uniformly to receipts too. A repeat receipt for the
    // SAME purchase (identical storeEventId) is an idempotent no-op here (record() returns null
    // on the journal's own [store, storeEventId] uniqueness) — the Transaction/Subscription
    // upserts underneath are ALSO independently idempotent by identity (design §7), so skipping a
    // second persist loses nothing; bind + replay + reassemble still run below regardless.
    const journalRow = await this.journal.record({
      store: validated.store,
      storeEventId: validated.storeEventId,
      notificationType: validated.notificationType,
      projectId: sdkApp.projectId,
      appId: sdkApp.id,
      appUserId: customer.appUserId,
      payload: validated.payload,
    });

    if (journalRow) {
      await persistLifecycleEvent({
        prisma: this.prisma,
        journal: this.journal,
        journalRowId: journalRow.id,
        app: resolvedApp,
        store: validated.store,
        environment: validated.environment,
        event: validated.event,
        customerId: customer.id, // always non-null — receipts are a LINKED persist (never UNLINKED)
        transactionFacts: validated.transactionFacts,
        subscriptionIdentity: validated.subscriptionIdentity,
        ownershipType: validated.ownershipType,
      });
    }

    // Step 6: bind the store token to the Customer. No token on the receipt -> skip (still
    // persisted linked above; a future webhook for it lands UNLINKED and resolves on a later
    // intake, same as today).
    let boundCustomer = customer;
    if (validated.bindToken) {
      boundCustomer = await this.customers.bindStoreToken(sdkApp.projectId, customer.id, validated.store, validated.bindToken);
    }

    // Step 7: replay any UNLINKED/FAILED journal rows for this SAME purchase now that its token is
    // bound — the headline "a webhook that landed UNLINKED resolves on the next intake" behavior.
    if (validated.replayMatchKey) {
      await replayUnlinkedForToken(
        { journal: this.journal, appleIngest: this.appleIngest, googleIngest: this.googleIngest },
        resolvedApp,
        validated.store,
        validated.replayMatchKey,
      );
    }

    // Step 8: the SAME CustomerInfo assembly M5a's read endpoint uses.
    return this.assembler.assemble({ projectId: sdkApp.projectId, appId: sdkApp.id, customer: boundCustomer }, nowMs);
  }
}
