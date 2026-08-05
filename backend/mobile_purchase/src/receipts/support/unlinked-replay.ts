import { Store } from '../../../generated/client';
import type { StoreNotificationJournalService } from '../../webhooks/journal/store-notification-journal.service';
import type { AppleIngestService } from '../../webhooks/apple/apple-ingest.service';
import type { GoogleIngestService } from '../../webhooks/google/google-ingest.service';
import type { VerifiedAppleNotification } from '../../webhooks/apple/apple-notification-verifier';
import type { DeveloperNotification } from '../../webhooks/google/google-notification-envelope';
import type { ResolvedApp } from '../../webhooks/shared/persist-lifecycle-event';

/**
 * The headline `/v1/receipts` behavior (design §7/§10): after binding a store token to a
 * Customer, replay any journal rows that arrived UNLINKED (or FAILED) for the SAME purchase
 * before that bind existed — each replayed row now resolves the customer, links its Transaction,
 * and creates its Subscription.
 *
 * **M5-REQ-1 (replay scope):** `listUnlinkedForReplay` is called with `{ projectId }` ONLY —
 * never `appUserId`. An UNLINKED row's `appUserId` is always `null` (design §2: no customer link
 * was resolved when it was journaled — that's the definition of UNLINKED), so filtering the
 * journal QUERY by `appUserId` would silently return nothing every time. Filtering to THIS
 * purchase happens here instead, in application code, against each candidate row's own
 * store-specific stored payload.
 *
 * **M5-REQ-2 (rehydration):** Apple's journaled `VerifiedAppleNotification` payload declares real
 * `Date` fields (`signedDate`, `transaction.purchaseDate/expiresDate/revocationDate`,
 * `renewal.gracePeriodExpiresDate`), but a value read back from Prisma's `Json` column is plain
 * JSON — every one of those is an ISO STRING at this point, not a `Date` instance.
 * `persistLifecycleEvent`'s reducer calls `.getTime()` on several of these fields; a string has no
 * such method, so re-invoking `AppleIngestService.processJournaledNotification` with the raw
 * `row.payload` throws. `rehydrateApple` reconstructs real `Date` instances first.
 *
 * Google's `DeveloperNotification` payload has NO `Date` fields at all — `eventTimeMillis` is a
 * wire-format STRING the Google mapper itself `Number()`-converts (see
 * `google-notification-envelope.ts`) — so no rehydration is needed on that side; the raw payload
 * is handed to `GoogleIngestService.processJournaledNotification` as-is.
 */
export interface UnlinkedReplayDeps {
  journal: StoreNotificationJournalService;
  appleIngest: AppleIngestService;
  googleIngest: GoogleIngestService;
}

export async function replayUnlinkedForToken(deps: UnlinkedReplayDeps, app: ResolvedApp, store: Store, matchKey: string): Promise<void> {
  const candidates = await deps.journal.listUnlinkedForReplay({ projectId: app.projectId });

  for (const row of candidates) {
    if (row.store !== store) continue;
    // Receipt-origin journal rows (source: 'receipt') exist only for receipt idempotency — they are
    // NOT store webhooks and carry no notificationType. Sweeping one here would map it to NO_OP ->
    // markProcessed, silently masking a receipt whose synchronous persist had thrown (and never
    // creating its Subscription). Only genuine webhook rows are replayable.
    if (isReceiptOriginPayload(row.payload)) continue;

    if (store === Store.APP_STORE) {
      if (appleAccountTokenFromPayload(row.payload) !== matchKey) continue;
      await deps.appleIngest.processJournaledNotification(row.id, app, rehydrateApple(row.payload));
    } else {
      if (googlePurchaseTokenFromPayload(row.payload) !== matchKey) continue;
      await deps.googleIngest.processJournaledNotification(row.id, app, row.payload as unknown as DeveloperNotification);
    }
  }
}

/** Receipt-origin rows are journaled by the /v1/receipts path with `source: 'receipt'` purely for
 * idempotency; they are not webhooks and must never be replayed as one. */
function isReceiptOriginPayload(payload: unknown): boolean {
  return (payload as { source?: string } | null)?.source === 'receipt';
}

function appleAccountTokenFromPayload(payload: unknown): string | undefined {
  return (payload as { transaction?: { appAccountToken?: string } } | null)?.transaction?.appAccountToken;
}

function googlePurchaseTokenFromPayload(payload: unknown): string | undefined {
  const p = payload as
    | {
        subscriptionNotification?: { purchaseToken?: string };
        voidedPurchaseNotification?: { purchaseToken?: string };
        oneTimeProductNotification?: { purchaseToken?: string };
      }
    | null;
  return p?.subscriptionNotification?.purchaseToken ?? p?.voidedPurchaseNotification?.purchaseToken ?? p?.oneTimeProductNotification?.purchaseToken;
}

/** M5-REQ-2: rebuilds real `Date` instances on the fields `VerifiedAppleNotification` declares as
 * `Date` — everything else on the row passes through untouched. */
function rehydrateApple(payload: unknown): VerifiedAppleNotification {
  const p = payload as Record<string, unknown>;
  const transaction = p.transaction as Record<string, unknown> | undefined;
  const renewal = p.renewal as Record<string, unknown> | undefined;

  return {
    ...(p as unknown as VerifiedAppleNotification),
    signedDate: new Date(p.signedDate as string | number),
    transaction: transaction
      ? {
          ...(transaction as unknown as NonNullable<VerifiedAppleNotification['transaction']>),
          purchaseDate: new Date(transaction.purchaseDate as string | number),
          expiresDate: toOptionalDate(transaction.expiresDate),
          revocationDate: toOptionalDate(transaction.revocationDate),
        }
      : undefined,
    renewal: renewal
      ? {
          ...(renewal as unknown as NonNullable<VerifiedAppleNotification['renewal']>),
          gracePeriodExpiresDate: toOptionalDate(renewal.gracePeriodExpiresDate),
        }
      : undefined,
  };
}

function toOptionalDate(value: unknown): Date | undefined {
  return value === undefined || value === null ? undefined : new Date(value as string | number);
}
