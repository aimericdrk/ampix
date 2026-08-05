import type { PeriodType, SubscriptionStatus } from '../../../generated/client';

/**
 * The mutable subscription lifecycle fields a `Subscription` row carries (design §2), and nothing
 * else — no `id`/`projectId`/`customerId`/`appId`/`store`/`environment`/`productId`/identity
 * columns (`originalTransactionId`/`purchaseToken`) and no `priceCents`/`currency` (those are
 * recorded on `Transaction`, immutable per-event facts, not lifecycle state). M2/M3 own resolving
 * *which* Subscription row an event applies to and merge this object's fields into their
 * create/update `data` — this module only computes what those fields should become.
 */
export interface SubscriptionState {
  status: SubscriptionStatus;
  expiresAt: Date | null;
  autoRenewStatus: boolean;
  autoRenewProductId: string | null;
  unsubscribeDetectedAt: Date | null;
  billingIssueDetectedAt: Date | null;
  gracePeriodExpiresAt: Date | null;
  refundedAt: Date | null;
  periodType: PeriodType;
  lastEventAt: Date;
  storeProductId: string;
  purchasedAt: Date;
  originalPurchasedAt: Date | null;
}

/** `SubscriptionState` is already exactly the shape safe to merge into a Prisma `Subscription`
 * create/update `data` object — every field here is a real Prisma column (design §2). Kept as a
 * distinct alias, rather than deleted outright, so M2/M3 call sites that already reference
 * `PersistableSubscriptionState` / `toPersistableSubscriptionState()` don't need to change.
 *
 * History: this used to strip an internal-only `revokedFrom` pre-revoke snapshot that
 * `REFUND_REVERSED` needed to restore a revoked subscription. That snapshot broke across the DB
 * boundary — a `SubscriptionState` reloaded from Postgres (the normal M2/M3 path: load the current
 * row, then apply a separately-delivered webhook) never carries it, so a `REFUND_REVERSED`
 * following a REVOKED persisted in a prior request/process silently failed to restore. It has been
 * removed; `REFUND_REVERSED` now recomputes the restored state from the event's own authoritative
 * fields instead (RC-faithful: Apple resends full transaction+renewal info on every notification —
 * see `subscription-lifecycle-reducer.ts`'s `restoreFromRevoke`). */
export type PersistableSubscriptionState = SubscriptionState;

/** Identity passthrough — kept for M2/M3 call sites that already call this before merging a
 * `SubscriptionState` into a Prisma upsert `data` object. No longer strips anything: every
 * `SubscriptionState` field is a real Prisma column now (see `PersistableSubscriptionState`). */
export function toPersistableSubscriptionState(state: SubscriptionState): PersistableSubscriptionState {
  return state;
}

/**
 * The single store-agnostic event alphabet (design's explicit goal: "the transition logic lives
 * in one place, not duplicated per store"). Every `notificationType`×`subtype` row in design §1.1
 * (Apple) and every `notificationType` row in §1.2 (Google) maps to exactly one of these variants
 * — see `apple-notification-mapper.ts` / `google-notification-mapper.ts` for the row-by-row table.
 */
export type SubscriptionLifecycleEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWED'
  | 'BILLING_RECOVERED'
  | 'AUTO_RENEW_DISABLED'
  | 'AUTO_RENEW_ENABLED'
  | 'PRODUCT_CHANGE_IMMEDIATE'
  | 'PRODUCT_CHANGE_SCHEDULED'
  | 'ENTERED_GRACE_PERIOD'
  | 'ENTERED_BILLING_RETRY'
  | 'GRACE_PERIOD_EXPIRED'
  | 'EXPIRED'
  | 'PAUSED'
  | 'RESUMED'
  | 'REVOKED'
  | 'REFUND_REVERSED'
  | 'RENEWAL_EXTENDED'
  | 'PRICE_CHANGE'
  | 'OFFER_REDEEMED'
  | 'ONE_TIME_CHARGE'
  | 'NO_OP';

interface LifecycleEventBase<T extends SubscriptionLifecycleEventType> {
  type: T;
  /** Apple `signedDate` / Google RTDN `eventTimeMillis` (or the authoritative-fetch time, for
   * Google, since the fetch is what's actually applied — design §7). The ordering-guard input:
   * the reducer ignores an event strictly older than the subscription's current `lastEventAt`. */
  occurredAt: Date;
}

/** First purchase for this subscription identity. `periodType` carries whether it started as a
 * free trial, an introductory offer, or a straight paid purchase (design §1.1 `SUBSCRIBED`/
 * `INITIAL_BUY`, §1.2 `PURCHASED`(4)) — `PROMO` is intentionally excluded here, it is
 * `OFFER_REDEEMED`'s domain, not a first-purchase periodType. */
export interface InitialPurchaseEvent extends LifecycleEventBase<'INITIAL_PURCHASE'> {
  storeProductId: string;
  periodType: Extract<PeriodType, 'TRIAL' | 'INTRO' | 'NORMAL'>;
  purchasedAt: Date;
  /** Defaults to `purchasedAt` when omitted (first purchase = original purchase). */
  originalPurchasedAt?: Date;
  expiresAt: Date;
  autoRenewStatus: boolean;
  autoRenewProductId?: string | null;
  ownershipType?: 'PURCHASED' | 'FAMILY_SHARED';
  priceCents?: number;
  currency?: string;
}

/** A scheduled renewal succeeded (Apple `DID_RENEW` w/o subtype, Google `RENEWED`(2)). Also the
 * trial/intro → paid conversion (design §4 "trial → active"): a renewal always yields `NORMAL`. */
export interface RenewedEvent extends LifecycleEventBase<'RENEWED'> {
  storeProductId: string;
  expiresAt: Date;
  autoRenewStatus?: boolean;
  priceCents?: number;
  currency?: string;
}

/** Billing recovered after a prior failure (Apple `DID_RENEW`/`BILLING_RECOVERY`, Google
 * `RECOVERED`(1)). */
export interface BillingRecoveredEvent extends LifecycleEventBase<'BILLING_RECOVERED'> {
  expiresAt?: Date;
}

/** User (or the store) turned auto-renew off. Still entitled until `expiresAt` (design's
 * RC-fidelity check: cancellation ≠ loss of access). */
export type AutoRenewDisabledEvent = LifecycleEventBase<'AUTO_RENEW_DISABLED'>;

/** Auto-renew re-enabled before expiry (Apple `DID_CHANGE_RENEWAL_STATUS`/`AUTO_RENEW_ENABLED`,
 * Google `RESTARTED`(7)). */
export type AutoRenewEnabledEvent = LifecycleEventBase<'AUTO_RENEW_ENABLED'>;

/** Upgrade/crossgrade: takes effect immediately, proration handled store-side (Apple
 * `DID_CHANGE_RENEWAL_PREF`/`UPGRADE`). */
export interface ProductChangeImmediateEvent extends LifecycleEventBase<'PRODUCT_CHANGE_IMMEDIATE'> {
  storeProductId: string;
  purchasedAt: Date;
  expiresAt: Date;
  priceCents?: number;
  currency?: string;
}

/** Downgrade: recorded as pending, applied at the next renewal (Apple
 * `DID_CHANGE_RENEWAL_PREF`/`DOWNGRADE`). */
export interface ProductChangeScheduledEvent extends LifecycleEventBase<'PRODUCT_CHANGE_SCHEDULED'> {
  autoRenewProductId: string;
}

/** Billing failed, store is retrying AND the subscriber stays entitled during the grace window
 * (Apple `DID_FAIL_TO_RENEW`/`GRACE_PERIOD`, Google `IN_GRACE_PERIOD`(6)). `null` when the store
 * signals grace without a known expiry (Google `IN_GRACE_PERIOD` can omit
 * `gracePeriodExpiryTime` — M5: tolerated rather than treated as a mapper error). */
export interface EnteredGracePeriodEvent extends LifecycleEventBase<'ENTERED_GRACE_PERIOD'> {
  gracePeriodExpiresAt: Date | null;
}

/** Billing failed, NOT entitled, store still retrying, no grace window (Apple
 * `DID_FAIL_TO_RENEW` w/o subtype, Google `ON_HOLD`(5)). */
export type EnteredBillingRetryEvent = LifecycleEventBase<'ENTERED_BILLING_RETRY'>;

/** Grace window ended, store still retrying but access is now off (Apple
 * `GRACE_PERIOD_EXPIRED`). */
export type GracePeriodExpiredEvent = LifecycleEventBase<'GRACE_PERIOD_EXPIRED'>;

/** Terminal: subscription ended (Apple `EXPIRED`/*, Google `EXPIRED`(13)). */
export type ExpiredEvent = LifecycleEventBase<'EXPIRED'>;

/** Google-only: subscriber paused, not entitled, `willRenew` stays true (design §1.2 `PAUSED`(10)
 * — the store still auto-resumes and charges later). */
export type PausedEvent = LifecycleEventBase<'PAUSED'>;

/** A paused subscription resumed. No `notificationType` row maps to this directly today — Google
 * signals a real-world resume via a plain `RENEWED`(2), which the reducer already handles
 * regardless of the prior status. Kept in the alphabet per the design brief for forward
 * compatibility / explicitness. */
export interface ResumedEvent extends LifecycleEventBase<'RESUMED'> {
  expiresAt?: Date;
}

/** Refund, Family Sharing revoke, or a voided/chargeback purchase — immediate loss of access
 * (Apple `REFUND`/`REVOKE`, Google `REVOKED`(12) and `voidedPurchaseNotification`). */
export interface RevokedEvent extends LifecycleEventBase<'REVOKED'> {
  /** Apple's `revocationDate`, when distinct from `occurredAt` (the notification's `signedDate`).
   * Falls back to `occurredAt` when absent. */
  revokedAt?: Date;
}

/** A prior refund/revoke was reversed (Apple `REFUND_REVERSED`). RC-faithful design: Apple ASSN v2
 * notifications are self-contained — every notification carries the full authoritative
 * transaction + `signedRenewalInfo`, not just a delta — so this event carries what the reducer
 * needs to recompute the restored non-terminal status deterministically. Nothing depends on an
 * in-memory pre-revoke snapshot (that approach broke across the DB boundary — see
 * `subscription-lifecycle.types.ts`'s `PersistableSubscriptionState` history note). Google has no
 * refund-reversal RTDN; recovering a `REVOKED` Google subscription is an M3 reconciliation concern
 * (synthesizing an `INITIAL_PURCHASE` from the re-fetched `subscriptionsv2` state), not this event. */
export interface RefundReversedEvent extends LifecycleEventBase<'REFUND_REVERSED'> {
  /** Authoritative post-reversal expiry (Apple transaction `expiresDate`). `null` when the store
   * has none to report — the reducer treats that as "not (yet) expired". */
  expiresAt: Date | null;
  /** Authoritative post-reversal renewal intent (Apple `signedRenewalInfo.autoRenewStatus`). */
  autoRenewStatus: boolean;
}

/** Store/developer-granted extension (Apple `RENEWAL_EXTENDED`/`RENEWAL_EXTENSION`, Google
 * `DEFERRED`(9)) — extends `expiresAt` only, no status change. */
export interface RenewalExtendedEvent extends LifecycleEventBase<'RENEWAL_EXTENDED'> {
  expiresAt: Date;
}

/** Price-increase consent state (Apple `PRICE_INCREASE`/`PENDING`|`ACCEPTED`) or a confirmed
 * price change (Google `PRICE_CHANGE_CONFIRMED`(8)) — informational, no access change. */
export type PriceChangeEvent = LifecycleEventBase<'PRICE_CHANGE'>;

/** Promotional/win-back offer applied (Apple `OFFER_REDEEMED`) — updates `periodType`/product. */
export interface OfferRedeemedEvent extends LifecycleEventBase<'OFFER_REDEEMED'> {
  storeProductId?: string;
  periodType?: PeriodType;
  expiresAt?: Date;
}

/** Non-renewing/consumable purchase (Apple `ONE_TIME_CHARGE`, Google `oneTimeProductNotification`
 * type 1/2). These products have no `Subscription` row at all per design §2/§4 ("Non-renewing /
 * non-consumable products entitle from a Transaction with no `expiresAt`") — kept in the alphabet
 * for table completeness, but the reducer treats it as a no-op on `SubscriptionState`; M2/M3
 * should route it straight to `Transaction` creation and never call `applyLifecycleEvent` for it. */
export interface OneTimeChargeEvent extends LifecycleEventBase<'ONE_TIME_CHARGE'> {
  storeProductId?: string;
  purchasedAt?: Date;
  priceCents?: number;
  currency?: string;
}

/** Explicit no-op: Apple `TEST`/`CONSUMPTION_REQUEST`/`REFUND_DECLINED`, Google `testNotification`,
 * `PAUSE_SCHEDULE_CHANGED`(11) (scheduling metadata, not a `SubscriptionState` field),
 * `PENDING_PURCHASE_CANCELED`(20) (abandoned before any grant existed). Journaled by M2/M3;
 * carries no lifecycle-state effect. */
export interface NoOpEvent extends LifecycleEventBase<'NO_OP'> {
  reason?: string;
}

export type SubscriptionLifecycleEvent =
  | InitialPurchaseEvent
  | RenewedEvent
  | BillingRecoveredEvent
  | AutoRenewDisabledEvent
  | AutoRenewEnabledEvent
  | ProductChangeImmediateEvent
  | ProductChangeScheduledEvent
  | EnteredGracePeriodEvent
  | EnteredBillingRetryEvent
  | GracePeriodExpiredEvent
  | ExpiredEvent
  | PausedEvent
  | ResumedEvent
  | RevokedEvent
  | RefundReversedEvent
  | RenewalExtendedEvent
  | PriceChangeEvent
  | OfferRedeemedEvent
  | OneTimeChargeEvent
  | NoOpEvent;
