import { ProblemException } from '../../common/problem-details';
import { Environment, ProductType, Store } from '../../../generated/client';
import { GoogleCredentialsUnavailableError } from '../../webhooks/google/store-client.google-api';
import type { GoogleOneTimeProductPurchase, GoogleSubscriptionV2, StoreClient } from '../../webhooks/google/store-client';
import { googleNotificationToEvent } from '../../subscriptions/lifecycle/google-notification-mapper';
import { buildSubscriptionTransactionFacts, toGoogleSubscriptionFacts } from '../../webhooks/google/google-ingest.service';
import type { TransactionFacts } from '../../webhooks/shared/persist-lifecycle-event';
import { toJsonPayload, type ValidatedReceipt } from './validated-receipt';

export interface GoogleReceiptFields {
  fetch_token: string;
  product_id?: string;
}

/**
 * M5b Google receipt validation: `fetch_token` is the `purchaseToken` itself. Mirrors
 * `GoogleIngestService.handleSubscriptionNotification`'s "RTDN carries no state, always re-fetch
 * the authoritative `subscriptionsv2.get()`" posture (design §1.2) — a receipt intake has no
 * notification at all, so the SAME authoritative fetch IS the entire validation. Tries the
 * subscription fetch first; falls back to `purchases.products.get` (one-time products) only when
 * a `product_id` was given AND the subscription fetch found nothing — matching how the SDK would
 * know which product it just bought (M3b's `getProduct` needs a productId the subscription path
 * does not).
 */
export async function validateGoogleReceipt(
  storeClient: StoreClient,
  packageName: string | null,
  input: GoogleReceiptFields,
  nowMs: number,
): Promise<ValidatedReceipt> {
  if (!packageName) {
    throw new ProblemException({
      status: 402,
      title: 'Store rejected the receipt',
      detail: 'App has no configured Google packageName',
    });
  }

  const fetched = await fetchSubscription(storeClient, packageName, input.fetch_token);
  if (fetched) {
    try {
      return buildSubscriptionReceipt(fetched, input.fetch_token, packageName, nowMs);
    } catch (e) {
      throw toReceiptRejected(e);
    }
  }

  if (input.product_id) {
    const product = await fetchProduct(storeClient, packageName, input.product_id, input.fetch_token);
    if (product) {
      try {
        return buildOneTimeReceipt(product, input.product_id, input.fetch_token, nowMs);
      } catch (e) {
        throw toReceiptRejected(e);
      }
    }
  }

  // design §5: "402 store rejects the receipt" — Google returned no purchase at all for this
  // fetch_token (a genuine 404, `StoreClient`'s null-vs-throw contract), same as Apple's bad
  // signature: this is not a receipt we can accept.
  throw new ProblemException({
    status: 402,
    title: 'Store rejected the receipt',
    detail: 'Google Play returned no purchase for the given fetch_token',
  });
}

async function fetchSubscription(storeClient: StoreClient, packageName: string, purchaseToken: string): Promise<GoogleSubscriptionV2 | null> {
  try {
    return await storeClient.getSubscriptionV2(packageName, purchaseToken);
  } catch (e) {
    throw toCredentialsUnavailable(e);
  }
}

async function fetchProduct(
  storeClient: StoreClient,
  packageName: string,
  productId: string,
  purchaseToken: string,
): Promise<GoogleOneTimeProductPurchase | null> {
  try {
    return await storeClient.getProduct(packageName, productId, purchaseToken);
  } catch (e) {
    throw toCredentialsUnavailable(e);
  }
}

/** design §1.2/§8: creds-gated `StoreClient` failures map to 503 (replayable at the store layer —
 * the receipt itself may be fine, we just can't validate it right now), never a 402/500. */
function toCredentialsUnavailable(e: unknown): unknown {
  if (e instanceof GoogleCredentialsUnavailableError) {
    return new ProblemException({ status: 503, title: 'Store credentials unavailable', detail: e.message });
  }
  return e;
}

function toReceiptRejected(e: unknown): unknown {
  if (e instanceof ProblemException) return e;
  return new ProblemException({ status: 402, title: 'Store rejected the receipt', detail: e instanceof Error ? e.message : String(e) });
}

function buildSubscriptionReceipt(fetched: GoogleSubscriptionV2, purchaseToken: string, packageName: string, nowMs: number): ValidatedReceipt {
  const lineItem = fetched.lineItems[0];
  if (!lineItem) {
    throw new Error('Google subscription purchase has no lineItems');
  }

  const facts = toGoogleSubscriptionFacts(lineItem);
  // Receipts have no RTDN notificationType — synthesized as `4` (`PURCHASED`), the same mapping a
  // real first-sight RTDN for this purchase would have driven (design §1.2's own table); Google's
  // fetched state carries no per-charge event time distinct from "now" (see
  // `buildSubscriptionTransactionFacts`'s own docs), so `nowMs` is the closest available signal.
  const event = googleNotificationToEvent({ kind: 'subscription', notificationType: 4, eventTimeMillis: nowMs, facts });
  if (event.type !== 'INITIAL_PURCHASE') {
    // Unreachable in practice (notificationType 4 always maps to INITIAL_PURCHASE — see
    // `google-notification-mapper.ts`'s `mapInitialPurchase`); guarded so `buildSubscriptionTransactionFacts`
    // (which requires this narrower type) is only ever called with a value TypeScript itself has
    // verified, rather than an unchecked cast.
    throw new Error(`unexpected event type "${event.type}" for a receipt-derived Google subscription purchase`);
  }

  const transactionFacts: TransactionFacts = buildSubscriptionTransactionFacts(fetched, lineItem, event, packageName);

  return {
    store: Store.PLAY_STORE,
    environment: Environment.PRODUCTION,
    event,
    subscriptionIdentity: { kind: 'purchaseToken', value: purchaseToken },
    transactionFacts,
    bindToken: fetched.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    // Google's RTDN envelope never carries obfuscatedExternalAccountId (design §1.2: "RTDN
    // carries no state") — purchaseToken is the only pre-fetch correlation key a journaled
    // webhook row for THIS purchase carries, so replay matches on it instead of bindToken.
    replayMatchKey: purchaseToken,
    storeEventId: transactionFacts.storeTransactionId,
    notificationType: 'RECEIPT_VALIDATION',
    payload: transactionFacts.rawPayload,
  };
}

function buildOneTimeReceipt(fetched: GoogleOneTimeProductPurchase, productId: string, purchaseToken: string, nowMs: number): ValidatedReceipt {
  if (!fetched.orderId) {
    throw new Error('Google product purchase has no orderId');
  }

  const event = googleNotificationToEvent({ kind: 'one_time', eventTimeMillis: nowMs, notificationType: 1, sku: productId });
  const payload = toJsonPayload({ source: 'receipt', purchase: fetched });
  const transactionFacts: TransactionFacts = {
    storeTransactionId: fetched.orderId,
    originalTransactionId: null,
    storeProductId: productId,
    // Play's purchase record doesn't distinguish consumable vs. non-consumable (catalog-level
    // config, not part of the purchase) — same default `google-ingest.service.ts` uses.
    type: ProductType.NON_CONSUMABLE,
    purchasedAt: fetched.purchaseTimeMillis ? new Date(Number(fetched.purchaseTimeMillis)) : new Date(nowMs),
    expiresAt: null,
    priceCents: null,
    currency: null,
    revokedAt: null,
    rawPayload: payload,
  };

  return {
    store: Store.PLAY_STORE,
    environment: Environment.PRODUCTION,
    event,
    subscriptionIdentity: null,
    transactionFacts,
    bindToken: fetched.obfuscatedExternalAccountId ?? null,
    replayMatchKey: purchaseToken,
    storeEventId: fetched.orderId,
    notificationType: 'RECEIPT_VALIDATION',
    payload,
  };
}
