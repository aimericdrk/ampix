import { ProblemException } from '../../common/problem-details';
import { Store } from '../../../generated/client';
import {
  AppleNotificationVerifier,
  AppleSignatureError,
  ApplePayloadError,
} from '../../webhooks/apple/apple-notification-verifier';
import {
  appleNotificationToEvent,
  type AppleDecodedNotification,
  type AppleDecodedTransactionInfo,
} from '../../subscriptions/lifecycle/apple-notification-mapper';
import { mapAppleEnvironment, mapAppleTransactionType, mapOwnershipType } from '../../webhooks/apple/apple-ingest.mappings';
import type { TransactionFacts } from '../../webhooks/shared/persist-lifecycle-event';
import { toJsonPayload, type ValidatedReceipt } from './validated-receipt';

/**
 * M5b Apple receipt validation: `fetch_token` is a STANDALONE StoreKit2 transaction JWS — not a
 * wrapping ASSN v2 notification (no `signedPayload` envelope, no `notificationUUID`, no
 * `signedRenewalInfo`) — verified via `AppleNotificationVerifier.verifyAndDecodeTransactionJws`
 * (the M2a verifier, extended for M5b: same x5c-chain + ES256 + bundleId/environment check,
 * fail-closed the same way).
 *
 * Reuses the SAME event-mapping path M2b's webhook ingest uses (`appleNotificationToEvent`) by
 * synthesizing the notification envelope this receipt is equivalent to, rather than
 * re-deriving `periodType`/`autoRenewStatus` logic a second time: design §1.1's own table says a
 * fresh auto-renewable purchase is `SUBSCRIBED`/`INITIAL_BUY`, and a fresh non-renewing/consumable
 * purchase is `ONE_TIME_CHARGE` — `transaction.type` is exactly what a real ASSN notification's
 * own `notificationType` would have been derived from for a first-sight purchase, so branching on
 * it here is a faithful reconstruction, not a guess.
 */
export async function validateAppleReceipt(verifier: AppleNotificationVerifier, fetchToken: string): Promise<ValidatedReceipt> {
  let decoded: AppleDecodedTransactionInfo;
  try {
    decoded = await verifier.verifyAndDecodeTransactionJws(fetchToken);
  } catch (e) {
    if (e instanceof AppleSignatureError || e instanceof ApplePayloadError) {
      // design §5: "bad signature -> 402 (store rejects the receipt)". A payload-shape defect on
      // an otherwise-genuinely-signed transaction is treated the same way here — either way this
      // is not a receipt we can accept.
      throw new ProblemException({ status: 402, title: 'Store rejected the receipt', detail: e.message });
    }
    throw e;
  }

  const isAutoRenewable = decoded.type === 'Auto-Renewable Subscription';
  const notification: AppleDecodedNotification = {
    notificationType: isAutoRenewable ? 'SUBSCRIBED' : 'ONE_TIME_CHARGE',
    subtype: isAutoRenewable ? 'INITIAL_BUY' : undefined,
    signedDate: decoded.purchaseDate,
    transaction: decoded,
    renewal: undefined,
  };
  const event = appleNotificationToEvent(notification);

  const payload = toJsonPayload({ source: 'receipt', transaction: decoded });
  const transactionFacts: TransactionFacts = {
    storeTransactionId: decoded.transactionId,
    originalTransactionId: decoded.originalTransactionId,
    storeProductId: decoded.productId,
    type: mapAppleTransactionType(decoded.type),
    purchasedAt: decoded.purchaseDate,
    expiresAt: decoded.expiresDate ?? null,
    priceCents: decoded.price ?? null,
    currency: decoded.currency ?? null,
    revokedAt: decoded.revocationDate ?? null,
    rawPayload: payload,
  };

  return {
    store: Store.APP_STORE,
    // A bare transaction JWS carries its OWN `environment` field (unlike the nested-in-notification
    // case, there is no wrapping `data.environment` to read instead) — falls back to Sandbox (the
    // less production-risky default) on the defensive case where Apple omits it, matching
    // `mapAppleEnvironment`'s own "anything other than exactly Production defaults to Sandbox" rule.
    environment: mapAppleEnvironment(decoded.environment ?? 'Sandbox'),
    event,
    subscriptionIdentity: event.type === 'ONE_TIME_CHARGE' ? null : { kind: 'originalTransactionId', value: decoded.originalTransactionId },
    transactionFacts,
    ownershipType: mapOwnershipType(decoded.inAppOwnershipType),
    bindToken: decoded.appAccountToken ?? null,
    replayMatchKey: decoded.appAccountToken ?? null,
    storeEventId: decoded.transactionId,
    notificationType: 'RECEIPT_VALIDATION',
    payload,
  };
}
