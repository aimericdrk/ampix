import type { InitialPurchaseEvent, SubscriptionLifecycleEvent } from './subscription-lifecycle.types';

/**
 * The already-verified-and-decoded facts M2 (Apple ASSN v2 ingest) extracts from
 * `JWSTransactionDecodedPayload` (design §1.1). This mapper is pure and never touches JWS/x5c —
 * that verification+decoding is entirely M2's job; by the time a notification reaches here it is
 * already trusted.
 */
export interface AppleDecodedTransactionInfo {
  productId: string;
  purchaseDate: Date;
  expiresDate?: Date;
  /** Apple `type` (`Auto-Renewable Subscription` / `Non-Consumable` / `Consumable` / ...),
   * normalized by M2. Unused by this mapper's own logic today but carried through for M2/M3's
   * Transaction record. */
  type?: string;
  inAppOwnershipType?: 'PURCHASED' | 'FAMILY_SHARED';
  /** Apple's numeric offer-type code, normalized to a string by M2. `FREE_TRIAL` and
   * `INTRODUCTORY` drive `INITIAL_PURCHASE.periodType`; anything else (`PROMOTIONAL`,
   * `OFFER_CODE`, `WIN_BACK`, absent) is treated as a normal paid purchase — a promotional offer
   * is still a real (if discounted) charge, not a trial. */
  offerType?: string;
  /** Apple `revocationDate` — set only on a REFUND/REVOKE transaction, distinct from the
   * notification's own `signedDate`. */
  revocationDate?: Date;
  price?: number;
  currency?: string;
}

/** The already-decoded `JWSRenewalInfoDecodedPayload` facts (design §1.1). */
export interface AppleDecodedRenewalInfo {
  /** Apple's raw 0/1 encoding, passed through by M2 (not yet coerced to boolean). */
  autoRenewStatus?: 0 | 1;
  autoRenewProductId?: string;
  gracePeriodExpiresDate?: Date;
}

/** The normalized `responseBodyV2DecodedPayload` shape this mapper consumes — see design §1.1 for
 * the full field list M2 decodes; only what this mapper needs is modeled here. */
export interface AppleDecodedNotification {
  notificationType: string;
  subtype?: string;
  /** `signedDate` — the ordering-guard input (design §7), becomes the event's `occurredAt`. */
  signedDate: Date;
  transaction?: AppleDecodedTransactionInfo;
  renewal?: AppleDecodedRenewalInfo;
}

/**
 * Maps one decoded Apple ASSN v2 notification to the store-agnostic
 * `SubscriptionLifecycleEvent` alphabet — the row-by-row table below is design §1.1 verbatim.
 *
 * | notificationType              | subtype                                             | event |
 * |---|---|---|
 * | `SUBSCRIBED`                   | `INITIAL_BUY` / `RESUBSCRIBE`                      | `INITIAL_PURCHASE` |
 * | `DID_RENEW`                    | — / `BILLING_RECOVERY`                             | `RENEWED` / `BILLING_RECOVERED` |
 * | `DID_CHANGE_RENEWAL_STATUS`    | `AUTO_RENEW_DISABLED` / `AUTO_RENEW_ENABLED` / other or missing | `AUTO_RENEW_DISABLED` / `AUTO_RENEW_ENABLED` / `NO_OP` |
 * | `DID_CHANGE_RENEWAL_PREF`      | `UPGRADE` / `DOWNGRADE` / other or missing         | `PRODUCT_CHANGE_IMMEDIATE` / `PRODUCT_CHANGE_SCHEDULED` / `NO_OP` |
 * | `DID_FAIL_TO_RENEW`            | `GRACE_PERIOD` / —                                 | `ENTERED_GRACE_PERIOD` / `ENTERED_BILLING_RETRY` |
 * | `GRACE_PERIOD_EXPIRED`         | —                                                   | `GRACE_PERIOD_EXPIRED` |
 * | `EXPIRED`                      | `VOLUNTARY`/`BILLING_RETRY`/`PRICE_INCREASE`/`PRODUCT_NOT_FOR_SALE` | `EXPIRED` |
 * | `OFFER_REDEEMED`               | —                                                   | `OFFER_REDEEMED` |
 * | `PRICE_INCREASE`               | `PENDING` / `ACCEPTED`                             | `PRICE_CHANGE` |
 * | `RENEWAL_EXTENDED` / `RENEWAL_EXTENSION` | —                                         | `RENEWAL_EXTENDED` |
 * | `REFUND` / `REVOKE`            | —                                                   | `REVOKED` |
 * | `REFUND_REVERSED`              | —                                                   | `REFUND_REVERSED` (carries authoritative `expiresAt`/`autoRenewStatus` for the reducer's restore recompute — C1) |
 * | `REFUND_DECLINED` / `CONSUMPTION_REQUEST` / `TEST` | —                              | `NO_OP` |
 * | `ONE_TIME_CHARGE`              | —                                                   | `ONE_TIME_CHARGE` |
 * | anything else (forward compat) | —                                                   | `NO_OP` |
 */
export function appleNotificationToEvent(input: AppleDecodedNotification): SubscriptionLifecycleEvent {
  const occurredAt = input.signedDate;

  switch (input.notificationType) {
    case 'SUBSCRIBED':
      return mapInitialPurchase(input, occurredAt);

    case 'DID_RENEW':
      if (input.subtype === 'BILLING_RECOVERY') {
        return { type: 'BILLING_RECOVERED', occurredAt, expiresAt: input.transaction?.expiresDate };
      }
      return mapRenewed(input, occurredAt);

    case 'DID_CHANGE_RENEWAL_STATUS':
      if (input.subtype === 'AUTO_RENEW_DISABLED') return { type: 'AUTO_RENEW_DISABLED', occurredAt };
      if (input.subtype === 'AUTO_RENEW_ENABLED') return { type: 'AUTO_RENEW_ENABLED', occurredAt };
      // M3: an unrecognized or missing subtype is forward-compatible NO_OP, consistent with an
      // unrecognized notificationType — not a throw (this used to crash ingest on any subtype
      // Apple adds later).
      return { type: 'NO_OP', occurredAt, reason: `DID_CHANGE_RENEWAL_STATUS with unrecognized subtype: ${input.subtype}` };

    case 'DID_CHANGE_RENEWAL_PREF':
      if (input.subtype === 'UPGRADE') return mapProductChangeImmediate(input, occurredAt);
      if (input.subtype === 'DOWNGRADE') return mapProductChangeScheduled(input, occurredAt);
      // M3: same forward-compatible NO_OP treatment as DID_CHANGE_RENEWAL_STATUS above.
      return { type: 'NO_OP', occurredAt, reason: `DID_CHANGE_RENEWAL_PREF with unrecognized subtype: ${input.subtype}` };

    case 'DID_FAIL_TO_RENEW':
      if (input.subtype === 'GRACE_PERIOD') return mapEnteredGracePeriod(input, occurredAt);
      return { type: 'ENTERED_BILLING_RETRY', occurredAt };

    case 'GRACE_PERIOD_EXPIRED':
      return { type: 'GRACE_PERIOD_EXPIRED', occurredAt };

    case 'EXPIRED':
      return { type: 'EXPIRED', occurredAt };

    case 'OFFER_REDEEMED':
      return {
        type: 'OFFER_REDEEMED',
        occurredAt,
        storeProductId: input.transaction?.productId,
        periodType: 'PROMO',
        expiresAt: input.transaction?.expiresDate,
      };

    case 'PRICE_INCREASE':
      // M7 (documented, not fixed here): the subtype (PENDING/ACCEPTED = the consumer's
      // price-increase consent status) has no §2 Subscription column to persist — a spec §1.1↔§2
      // gap. Informational only today; PRICE_CHANGE carries no field for it.
      return { type: 'PRICE_CHANGE', occurredAt };

    case 'RENEWAL_EXTENDED':
    case 'RENEWAL_EXTENSION':
      return { type: 'RENEWAL_EXTENDED', occurredAt, expiresAt: requireDate(input.transaction?.expiresDate, 'transaction.expiresDate') };

    case 'REFUND':
    case 'REVOKE':
      return { type: 'REVOKED', occurredAt, revokedAt: input.transaction?.revocationDate };

    case 'REFUND_REVERSED':
      // C1: carry the authoritative post-reversal facts so the reducer can recompute the restored
      // status deterministically instead of depending on an in-memory pre-revoke snapshot. Apple
      // sends the full transaction + signedRenewalInfo on every ASSN v2 notification, including
      // this one; expiresAt defaults to null (reducer treats that as "not expired") only for the
      // defensive case where transaction info is somehow absent, and autoRenewStatus defaults to
      // `true` when renewal info is absent (see renewalStatusBoolean).
      return {
        type: 'REFUND_REVERSED',
        occurredAt,
        expiresAt: input.transaction?.expiresDate ?? null,
        autoRenewStatus: renewalStatusBoolean(input.renewal),
      };

    case 'REFUND_DECLINED':
    case 'CONSUMPTION_REQUEST':
    case 'TEST':
      return { type: 'NO_OP', occurredAt, reason: input.notificationType };

    case 'ONE_TIME_CHARGE':
      return {
        type: 'ONE_TIME_CHARGE',
        occurredAt,
        storeProductId: input.transaction?.productId,
        purchasedAt: input.transaction?.purchaseDate,
        priceCents: input.transaction?.price,
        currency: input.transaction?.currency,
      };

    default:
      // Forward-compatible: an Apple notificationType this mapper doesn't yet know about is
      // journaled (by M2) and has no lifecycle effect, rather than crashing ingest.
      return { type: 'NO_OP', occurredAt, reason: `unrecognized Apple notificationType: ${input.notificationType}` };
  }
}

function mapInitialPurchase(input: AppleDecodedNotification, occurredAt: Date): InitialPurchaseEvent {
  const transaction = requireTransaction(input);
  return {
    type: 'INITIAL_PURCHASE',
    occurredAt,
    storeProductId: transaction.productId,
    periodType: periodTypeFromOfferType(transaction.offerType),
    purchasedAt: transaction.purchaseDate,
    expiresAt: requireDate(transaction.expiresDate, 'transaction.expiresDate'),
    autoRenewStatus: renewalStatusBoolean(input.renewal),
    autoRenewProductId: input.renewal?.autoRenewProductId ?? null,
    ownershipType: transaction.inAppOwnershipType,
    priceCents: transaction.price,
    currency: transaction.currency,
  };
}

function mapRenewed(input: AppleDecodedNotification, occurredAt: Date): SubscriptionLifecycleEvent {
  const transaction = requireTransaction(input);
  return {
    type: 'RENEWED',
    occurredAt,
    storeProductId: transaction.productId,
    expiresAt: requireDate(transaction.expiresDate, 'transaction.expiresDate'),
    autoRenewStatus: input.renewal ? renewalStatusBoolean(input.renewal) : undefined,
    priceCents: transaction.price,
    currency: transaction.currency,
  };
}

function mapProductChangeImmediate(input: AppleDecodedNotification, occurredAt: Date): SubscriptionLifecycleEvent {
  const transaction = requireTransaction(input);
  return {
    type: 'PRODUCT_CHANGE_IMMEDIATE',
    occurredAt,
    storeProductId: transaction.productId,
    purchasedAt: transaction.purchaseDate,
    expiresAt: requireDate(transaction.expiresDate, 'transaction.expiresDate'),
    priceCents: transaction.price,
    currency: transaction.currency,
  };
}

function mapProductChangeScheduled(input: AppleDecodedNotification, occurredAt: Date): SubscriptionLifecycleEvent {
  const autoRenewProductId = input.renewal?.autoRenewProductId;
  if (!autoRenewProductId) {
    throw new Error('appleNotificationToEvent: DID_CHANGE_RENEWAL_PREF/DOWNGRADE requires renewal.autoRenewProductId');
  }
  return { type: 'PRODUCT_CHANGE_SCHEDULED', occurredAt, autoRenewProductId };
}

function mapEnteredGracePeriod(input: AppleDecodedNotification, occurredAt: Date): SubscriptionLifecycleEvent {
  const gracePeriodExpiresAt = input.renewal?.gracePeriodExpiresDate;
  if (!gracePeriodExpiresAt) {
    throw new Error('appleNotificationToEvent: DID_FAIL_TO_RENEW/GRACE_PERIOD requires renewal.gracePeriodExpiresDate');
  }
  return { type: 'ENTERED_GRACE_PERIOD', occurredAt, gracePeriodExpiresAt };
}

function periodTypeFromOfferType(offerType: string | undefined): 'TRIAL' | 'INTRO' | 'NORMAL' {
  if (offerType === 'FREE_TRIAL') return 'TRIAL';
  if (offerType === 'INTRODUCTORY') return 'INTRO';
  return 'NORMAL';
}

/** Apple's raw 0/1 `autoRenewStatus`, coerced to a boolean. Renewal info absent entirely (should
 * not happen for an auto-renewable transaction) defaults to `true` — absence is not the same as
 * an explicit off signal. */
function renewalStatusBoolean(renewal: AppleDecodedRenewalInfo | undefined): boolean {
  if (!renewal) return true;
  return renewal.autoRenewStatus === 1;
}

function requireTransaction(input: AppleDecodedNotification): AppleDecodedTransactionInfo {
  if (!input.transaction) {
    throw new Error(`appleNotificationToEvent: ${input.notificationType} requires transaction info`);
  }
  return input.transaction;
}

function requireDate(value: Date | undefined, field: string): Date {
  if (!value) throw new Error(`appleNotificationToEvent: missing required date field "${field}"`);
  return value;
}
