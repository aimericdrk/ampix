import type { Environment, OwnershipType, Prisma, Store } from '../../../generated/client';
import type { SubscriptionLifecycleEvent } from '../../subscriptions/lifecycle/subscription-lifecycle.types';
import type { SubscriptionIdentity, TransactionFacts } from '../../webhooks/shared/persist-lifecycle-event';

/**
 * The store-agnostic result of validating one `POST /v1/receipts` `fetch_token` against Apple or
 * Google (M5b) — everything `ReceiptsService` needs to persist the purchase via the SAME shared
 * `persistLifecycleEvent` core M2b/M3b use, bind the store token, and replay any previously
 * UNLINKED journal rows for this same purchase. Built by `apple-receipt-validator.ts` /
 * `google-receipt-validator.ts`; consumed only by `receipts.service.ts`.
 */
export interface ValidatedReceipt {
  store: Store;
  environment: Environment;
  event: SubscriptionLifecycleEvent;
  transactionFacts: TransactionFacts;
  /** `null` only for `ONE_TIME_CHARGE`-equivalent events (design §2/§4: non-renewing/consumable
   * purchases have no `Subscription` row at all). */
  subscriptionIdentity: SubscriptionIdentity | null;
  ownershipType?: OwnershipType;
  /** The store-side self-attribution token to bind to the resolved Customer (Apple
   * `appAccountToken`, Google `obfuscatedExternalAccountId`) — `null` when the receipt carries
   * none (brief-documented no-op: still persisted LINKED; a future webhook for the same purchase
   * lands UNLINKED and resolves on a later intake, same as today). */
  bindToken: string | null;
  /** The value to correlate against previously-UNLINKED/FAILED journal rows for THIS SAME
   * purchase during replay (design §7, M5-REQ-1). Apple: identical to `bindToken`
   * (`appAccountToken`, present directly in the journaled `VerifiedAppleNotification` payload).
   * Google: the `purchaseToken` (`fetch_token`) itself, NOT `bindToken` — Google's RTDN envelope
   * never carries `obfuscatedExternalAccountId` (design §1.2: "RTDN carries no state"), so
   * `purchaseToken` is the only pre-fetch correlation key a journaled Google row has. `null` only
   * alongside a `null` `bindToken` (Apple with no `appAccountToken` at all — nothing to replay
   * against either). */
  replayMatchKey: string | null;
  /** Journal idempotency key for this receipt (design §7 pattern, reused for receipts too):
   * Apple's `transactionId`, Google's `latestOrderId`/`orderId` — globally unique per store, so a
   * repeat POST of the identical receipt dedupes exactly like a duplicate webhook delivery does. */
  storeEventId: string;
  notificationType: string;
  payload: Prisma.InputJsonValue;
}

/** Normalizes a decoded/fetched value to a plain-JSON value (Dates -> ISO strings, `undefined`
 * fields dropped) before handing it to a Prisma `Json` column — matches
 * `apple-ingest.service.ts`/`google-ingest.service.ts`'s own `toJsonPayload` helpers (each ingest
 * module keeps its own small copy rather than sharing one; this follows the same convention). */
export function toJsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
