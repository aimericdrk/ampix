/**
 * The `StoreClient` interface (design §1.2 "Authoritative state fetch (hard dependency)" / §8 /
 * M3 acceptance criteria): RTDN carries no state, only a trigger + `purchaseToken`, so M3b must
 * call back into the Google Play Developer API v3 to get the truth. Modeled on the real
 * `purchases.subscriptionsv2.get` / `purchases.products.get` response shapes so M3b's real,
 * `googleapis`-backed implementation is a drop-in — this file defines the seam and the types only.
 *
 * NOT implemented here: the real client needs `App.storeCredentials` (the Play service-account
 * JSON), which is NULL until a later connect-store flow populates it (design §1.2/§8 — "Currently
 * NULL — blocks `subscriptionsv2.get`, i.e. all live Google ingest"). M3b must treat a
 * missing/NULL `storeCredentials` at fetch time as a journal `FAILED` (replayable), never a crash
 * or an uncaught rejection — the same fail-safe posture `AppleIngestService` already uses for any
 * processing error.
 */

/** Play Developer API v3 `SubscriptionState` enum values that appear on a `SubscriptionPurchaseV2`
 * (only the values the M4a mapper's notification-type table needs downstream are named here;
 * unknown/forward-compat values still type-check as `string`). */
export type GoogleSubscriptionState =
  | 'SUBSCRIPTION_STATE_UNSPECIFIED'
  | 'SUBSCRIPTION_STATE_PENDING'
  | 'SUBSCRIPTION_STATE_ACTIVE'
  | 'SUBSCRIPTION_STATE_PAUSED'
  | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
  | 'SUBSCRIPTION_STATE_ON_HOLD'
  | 'SUBSCRIPTION_STATE_CANCELED'
  | 'SUBSCRIPTION_STATE_EXPIRED'
  | (string & {});

export type GoogleAcknowledgementState =
  | 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED'
  | 'ACKNOWLEDGEMENT_STATE_PENDING'
  | 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
  | (string & {});

export interface GoogleAutoRenewingPlan {
  autoRenewEnabled: boolean;
}

export interface GoogleOfferDetails {
  offerId?: string;
  offerTags?: string[];
  basePlanId?: string;
}

/** One entry of `SubscriptionPurchaseV2.lineItems[]` — design §1.2: "lineItems[].{productId,
 * expiryTime, autoRenewingPlan, offerDetails}". `expiryTime` is RFC3339 UTC, as returned by the
 * real API (a string, not a `Date` — conversion is M3b's job when it maps this into
 * `GoogleSubscriptionFacts.expiryTime`). */
export interface GoogleSubscriptionLineItem {
  productId: string;
  expiryTime: string;
  autoRenewingPlan?: GoogleAutoRenewingPlan;
  offerDetails?: GoogleOfferDetails;
}

/** Design §1.2: "externalAccountIdentifiers.obfuscatedExternalAccountId (the customer link)". */
export interface GoogleExternalAccountIdentifiers {
  obfuscatedExternalAccountId?: string;
  obfuscatedExternalProfileId?: string;
}

/** The authoritative `SubscriptionPurchaseV2` shape (Play Developer API v3), trimmed to the fields
 * design §1.2 names: "subscriptionState, lineItems[].{productId, expiryTime, autoRenewingPlan,
 * offerDetails}, latestOrderId, linkedPurchaseToken, externalAccountIdentifiers.
 * obfuscatedExternalAccountId, acknowledgementState". */
export interface GoogleSubscriptionV2 {
  kind?: string;
  startTime?: string;
  subscriptionState: GoogleSubscriptionState;
  latestOrderId?: string;
  /** Set when this purchase token replaced an earlier one (upgrade/downgrade/resubscribe) —
   * chains Google's token rotation (design §7 ordering note). */
  linkedPurchaseToken?: string;
  lineItems: GoogleSubscriptionLineItem[];
  acknowledgementState?: GoogleAcknowledgementState;
  externalAccountIdentifiers?: GoogleExternalAccountIdentifiers;
}

/** The authoritative one-time-product purchase shape (Play Developer API v3
 * `purchases.products.get`, design §1.2 "One-time products use `purchases.products.get`").
 * `purchaseState`: 0 = purchased, 1 = canceled, 2 = pending.
 *
 * `orderId` (M3b addition — the real API returns it, M3a's transport-focused card didn't need it):
 * the Google order identifier for this purchase, required as `Transaction.storeTransactionId`
 * (design §2 — "Google's `storeTransactionId` = orderId", stated there for the subscription case
 * but equally true for one-time products; there is no other unique-enough field on this shape). */
export interface GoogleOneTimeProductPurchase {
  kind?: string;
  orderId?: string;
  purchaseTimeMillis?: string;
  purchaseState?: number;
  consumptionState?: number;
  purchaseToken?: string;
  productId?: string;
  quantity?: number;
  obfuscatedExternalAccountId?: string;
  obfuscatedExternalProfileId?: string;
  regionCode?: string;
}

/**
 * The store-facing dependency M3b's ingest pipeline calls into for authoritative state (design
 * §1.2/§8, M3 acceptance: "`StoreClient.getSubscriptionV2()` (interface, mocked in tests, real
 * needs the service account)"). M3a defines the contract + an in-memory fake for tests; the real,
 * `googleapis`-backed implementation (creds-gated on `App.storeCredentials`) is M3b's job.
 */
export interface StoreClient {
  /** `purchases.subscriptionsv2.get(packageName, purchaseToken)`. `null` signals "no such purchase
   * token" (a genuine 404 from Google) — distinct from a thrown error, which signals a transport/
   * auth/credentials failure the caller should treat as replayable-`FAILED`, not "unknown". */
  getSubscriptionV2(packageName: string, purchaseToken: string): Promise<GoogleSubscriptionV2 | null>;

  /** `purchases.products.get(packageName, productId, purchaseToken)` — one-time products. Same
   * `null`-vs-throw contract as `getSubscriptionV2`. */
  getProduct(packageName: string, productId: string, purchaseToken: string): Promise<GoogleOneTimeProductPurchase | null>;

  /** `purchases.subscriptions.revoke(packageName, purchaseToken)` — refund the LAST payment and
   * immediately revoke access (D1 refund design §1.3, RC's Google dashboard refund). Resolves on
   * store success; throws on any failure (`GoogleCredentialsUnavailableError` when credentials
   * are absent, anything else for a store rejection). No `null` case — a revoke either succeeded
   * or it threw. */
  revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>;
}
