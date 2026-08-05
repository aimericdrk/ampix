import type { InitialPurchaseEvent, SubscriptionLifecycleEvent } from './subscription-lifecycle.types';

/**
 * The authoritative facts M3 obtains from `purchases.subscriptionsv2.get()` (design §1.2 —
 * "Authoritative state fetch (hard dependency)"): RTDN itself carries no state, only a trigger +
 * `purchaseToken`, so every notification requiring lifecycle facts is mapped from this fetched
 * `SubscriptionPurchaseV2`, not from the RTDN envelope. `productId`/`expiryTime`/`autoRenewing`
 * are the *active* `lineItems[]` entry already resolved by M3; `isTrial`/`isIntro` come from that
 * line item's `offerDetails` (free-trial / intro-price phase), normalized by M3.
 */
export interface GoogleSubscriptionFacts {
  productId: string;
  expiryTime: Date;
  autoRenewing: boolean;
  isTrial?: boolean;
  isIntro?: boolean;
  gracePeriodExpiryTime?: Date;
  /** Google prices are micros (1_000_000 = one currency unit); converted to cents for parity with
   * Apple's `price` (design §1.1) and `Transaction.priceCents`. */
  priceMicros?: number;
  currencyCode?: string;
}

/** `subscriptionNotification` (design §1.2): `{ notificationType (int), purchaseToken,
 * subscriptionId }`, plus the authoritative fetch result M3 attaches as `facts`. `facts` is
 * optional at the type level only for the rare types that don't need it (e.g. `PENDING_PURCHASE_
 * CANCELED`); every other type requires it and this mapper throws if it's missing. */
export interface GoogleSubscriptionNotificationInput {
  kind: 'subscription';
  notificationType: number;
  eventTimeMillis: number;
  facts?: GoogleSubscriptionFacts;
}

/** `voidedPurchaseNotification` (design §1.2): `{ purchaseToken, orderId, productType,
 * refundType }`. `refundType` is Google's raw code (1 = `FULL_REFUND`, 2 =
 * `QUANTITY_BASED_REFUND`) — unused by the reducer today, carried through for M3's audit trail. */
export interface GoogleVoidedPurchaseNotificationInput {
  kind: 'voided';
  eventTimeMillis: number;
  refundType?: number;
}

/** `oneTimeProductNotification` (design §1.2): `{ notificationType (int), purchaseToken, sku }`.
 * `notificationType` 1 = `ONE_TIME_PRODUCT_PURCHASED`, 2 = `ONE_TIME_PRODUCT_CANCELED` — both map
 * to `ONE_TIME_CHARGE` here (design row: "consumable/non-consumable Transaction"); M2/M3
 * distinguish purchased-vs-canceled when building the Transaction record itself. */
export interface GoogleOneTimeProductNotificationInput {
  kind: 'one_time';
  eventTimeMillis: number;
  notificationType: number;
  sku: string;
  priceMicros?: number;
  currencyCode?: string;
}

/** `testNotification` (design §1.2) — RTDN test ping. */
export interface GoogleTestNotificationInput {
  kind: 'test';
  eventTimeMillis: number;
}

/** The normalized `DeveloperNotification` shape this mapper consumes (design §1.2): exactly one
 * of the four notification kinds Google's base64-decoded envelope carries. */
export type GoogleDecodedNotification =
  | GoogleSubscriptionNotificationInput
  | GoogleVoidedPurchaseNotificationInput
  | GoogleOneTimeProductNotificationInput
  | GoogleTestNotificationInput;

/**
 * Maps one decoded Google RTDN notification (+ its authoritative `subscriptionsv2.get()` facts,
 * where required) to the store-agnostic `SubscriptionLifecycleEvent` alphabet — the row-by-row
 * table below is design §1.2 verbatim.
 *
 * | type(int) | name | event |
 * |---|---|---|
 * | 1 | `RECOVERED` | `BILLING_RECOVERED` |
 * | 2 | `RENEWED` | `RENEWED` |
 * | 3 | `CANCELED` | `AUTO_RENEW_DISABLED` |
 * | 4 | `PURCHASED` | `INITIAL_PURCHASE` |
 * | 5 | `ON_HOLD` | `ENTERED_BILLING_RETRY` |
 * | 6 | `IN_GRACE_PERIOD` | `ENTERED_GRACE_PERIOD` (M5: `gracePeriodExpiresAt` is `null` when the fetched facts omit `gracePeriodExpiryTime`, rather than throwing) |
 * | 7 | `RESTARTED` | `AUTO_RENEW_ENABLED` |
 * | 8 | `PRICE_CHANGE_CONFIRMED` | `PRICE_CHANGE` |
 * | 9 | `DEFERRED` | `RENEWAL_EXTENDED` |
 * | 10 | `PAUSED` | `PAUSED` |
 * | 11 | `PAUSE_SCHEDULE_CHANGED` | `NO_OP` (scheduling metadata, not a `SubscriptionState` field) |
 * | 12 | `REVOKED` | `REVOKED` (Google has no refund-reversal RTDN — no notification maps to `REFUND_REVERSED` here; recovering a `REVOKED` Google subscription is an M3 reconciliation concern — M3 may synthesize an `INITIAL_PURCHASE` from the re-fetched `subscriptionsv2` state when it observes a previously-revoked purchase has become active again, rather than this mapper emitting anything) |
 * | 13 | `EXPIRED` | `EXPIRED` |
 * | 20 | `PENDING_PURCHASE_CANCELED` | `NO_OP` (abandoned before any grant existed) |
 * | — | `voidedPurchaseNotification` | `REVOKED` |
 * | — | `oneTimeProductNotification` 1/2 | `ONE_TIME_CHARGE` |
 * | — | `testNotification` | `NO_OP` |
 * | anything else (forward compat) | `NO_OP` |
 */
export function googleNotificationToEvent(input: GoogleDecodedNotification): SubscriptionLifecycleEvent {
  const occurredAt = new Date(input.eventTimeMillis);

  switch (input.kind) {
    case 'subscription':
      return mapSubscriptionNotification(input, occurredAt);

    case 'voided':
      return { type: 'REVOKED', occurredAt };

    case 'one_time':
      return {
        type: 'ONE_TIME_CHARGE',
        occurredAt,
        storeProductId: input.sku,
        priceCents: microsToCents(input.priceMicros),
        currency: input.currencyCode,
      };

    case 'test':
      return { type: 'NO_OP', occurredAt, reason: 'testNotification' };

    default:
      return assertNever(input);
  }
}

function mapSubscriptionNotification(
  input: GoogleSubscriptionNotificationInput,
  occurredAt: Date,
): SubscriptionLifecycleEvent {
  switch (input.notificationType) {
    case 1: // RECOVERED
      return { type: 'BILLING_RECOVERED', occurredAt, expiresAt: input.facts?.expiryTime };

    case 2: { // RENEWED
      const facts = requireFacts(input);
      return {
        type: 'RENEWED',
        occurredAt,
        storeProductId: facts.productId,
        expiresAt: facts.expiryTime,
        autoRenewStatus: facts.autoRenewing,
        priceCents: microsToCents(facts.priceMicros),
        currency: facts.currencyCode,
      };
    }

    case 3: // CANCELED
      return { type: 'AUTO_RENEW_DISABLED', occurredAt };

    case 4: // PURCHASED
      return mapInitialPurchase(input, occurredAt);

    case 5: // ON_HOLD
      return { type: 'ENTERED_BILLING_RETRY', occurredAt };

    case 6: { // IN_GRACE_PERIOD
      // M5: tolerate a missing gracePeriodExpiryTime rather than throwing — still entered grace,
      // just without a known expiry to report.
      const facts = requireFacts(input);
      return { type: 'ENTERED_GRACE_PERIOD', occurredAt, gracePeriodExpiresAt: facts.gracePeriodExpiryTime ?? null };
    }

    case 7: // RESTARTED
      return { type: 'AUTO_RENEW_ENABLED', occurredAt };

    case 8: // PRICE_CHANGE_CONFIRMED
      return { type: 'PRICE_CHANGE', occurredAt };

    case 9: { // DEFERRED
      const facts = requireFacts(input);
      return { type: 'RENEWAL_EXTENDED', occurredAt, expiresAt: facts.expiryTime };
    }

    case 10: // PAUSED
      return { type: 'PAUSED', occurredAt };

    case 11: // PAUSE_SCHEDULE_CHANGED — informational only, no SubscriptionState field carries it.
      return { type: 'NO_OP', occurredAt, reason: 'PAUSE_SCHEDULE_CHANGED' };

    case 12: // REVOKED
      return { type: 'REVOKED', occurredAt };

    case 13: // EXPIRED
      return { type: 'EXPIRED', occurredAt };

    case 20: // PENDING_PURCHASE_CANCELED — abandoned before any grant existed, nothing to update.
      return { type: 'NO_OP', occurredAt, reason: 'PENDING_PURCHASE_CANCELED' };

    default:
      // Forward-compatible: a Google notificationType this mapper doesn't yet know about is
      // journaled (by M3) and has no lifecycle effect, rather than crashing ingest.
      return { type: 'NO_OP', occurredAt, reason: `unrecognized Google notificationType: ${input.notificationType}` };
  }
}

function mapInitialPurchase(input: GoogleSubscriptionNotificationInput, occurredAt: Date): InitialPurchaseEvent {
  const facts = requireFacts(input);
  return {
    type: 'INITIAL_PURCHASE',
    occurredAt,
    storeProductId: facts.productId,
    periodType: facts.isTrial ? 'TRIAL' : facts.isIntro ? 'INTRO' : 'NORMAL',
    // Google's fetched SubscriptionPurchaseV2 doesn't carry a separate "purchase time" distinct
    // from the RTDN trigger for a first purchase — use the event time (M3 may override from
    // lineItems' startTime if a more precise value becomes available).
    purchasedAt: occurredAt,
    expiresAt: facts.expiryTime,
    autoRenewStatus: facts.autoRenewing,
    priceCents: microsToCents(facts.priceMicros),
    currency: facts.currencyCode,
  };
}

function requireFacts(input: GoogleSubscriptionNotificationInput): GoogleSubscriptionFacts {
  if (!input.facts) {
    throw new Error(
      `googleNotificationToEvent: notificationType ${input.notificationType} requires the authoritative subscriptionsv2.get() facts (design §1.2 — RTDN carries no state)`,
    );
  }
  return input.facts;
}

function microsToCents(priceMicros: number | undefined): number | undefined {
  if (priceMicros === undefined) return undefined;
  return Math.round(priceMicros / 10_000);
}

function assertNever(value: never): never {
  throw new Error(`googleNotificationToEvent: unhandled notification kind ${JSON.stringify(value)}`);
}
