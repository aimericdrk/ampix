import type {
  PeriodType as PrismaPeriodType,
  ProductType,
  Store as PrismaStore,
  SubscriptionStatus,
} from '../../generated/client';

/**
 * The persisted-row projections `computeCustomerInfo` reads (design §2's `Customer`/`Subscription`/
 * `Transaction` Prisma models, trimmed to only the fields the engine uses). M5 (the SDK read API)
 * loads the real rows and narrows them to these shapes before calling the engine — this module never
 * touches Prisma directly (brief: "PURE FUNCTION ONLY").
 */
export interface CustomerProjection {
  appUserId: string;
  /** `Customer.createdAt` — the customer's first-ever appearance. */
  firstSeenAt: Date;
  /** `Customer.lastSeenAt`; nullable in Prisma (never yet updated for a brand-new customer). */
  lastSeenAt: Date | null;
}

export interface SubscriptionProjection {
  status: SubscriptionStatus;
  store: PrismaStore;
  storeProductId: string;
  periodType: PrismaPeriodType;
  expiresAt: Date | null;
  autoRenewStatus: boolean;
  purchasedAt: Date;
  originalPurchasedAt: Date | null;
  unsubscribeDetectedAt: Date | null;
  billingIssueDetectedAt: Date | null;
}

export interface TransactionProjection {
  store: PrismaStore;
  storeProductId: string;
  type: ProductType;
  purchasedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * `storeProductId → the catalog entitlement identifiers it grants` — the resolved
 * `Product → ProductEntitlement → Entitlement` join (design §2's closing paragraph: "Entitlements
 * flow `Product → ProductEntitlement → Entitlement`"), built by the caller (M5), keyed by the
 * catalog `Entitlement.identifier` (the stable string the SDK checks, e.g.
 * `customerInfo.entitlements.active["premium"]`). A `storeProductId` absent from this map is an
 * unimported store product — design §4's "productId null ⇒ empty entitlements" rule: it
 * contributes NO entitlement, never an error.
 */
export type EntitlementLookup = Map<string, readonly string[]>;

/**
 * Design §1.2 — the pure projection of a customer's non-revoked promotional grant. The caller
 * (`CustomerInfoAssemblerService`) filters `revokedAt: null` before building this array; this
 * engine only ever sees active-or-expired grants, never revoked ones — revocation itself is not
 * a compute-on-read concern here, only expiry is (same as subscriptions/transactions).
 * `expiresAtMs` is `null` for a lifetime grant.
 */
export interface PromotionalEntitlementProjection {
  entitlementIdentifier: string;
  expiresAtMs: number | null;
}

export interface ComputeCustomerInfoInput {
  customer: CustomerProjection;
  subscriptions: readonly SubscriptionProjection[];
  transactions: readonly TransactionProjection[];
  promotionalEntitlements: readonly PromotionalEntitlementProjection[];
  entitlementsByStoreProductId: EntitlementLookup;
}

/** RC's `store` string, exactly as the SDK returns it (design §4 rule 6), plus the
 * `'promotional'` sentinel for admin-granted entitlements (design §1.2). */
export type Store = 'app_store' | 'play_store' | 'promotional';

/** RC's `periodType` string, exactly as the SDK returns it (design §4 rule 7). */
export type EntitlementPeriodType = 'normal' | 'trial' | 'intro' | 'promo';

/**
 * RC's ownership attribution. This engine can only ever produce `'PURCHASED'` today —
 * `'FAMILY_SHARED'` needs a `Subscription.ownershipType` column (Apple's `inAppOwnershipType`)
 * that design §2's `Subscription` model does not have. Flagged for M2 (Apple ingest, which already
 * decodes `inAppOwnershipType` per design §1.1) to add that column; NOT added here, per brief scope.
 */
export type OwnershipType = 'PURCHASED' | 'FAMILY_SHARED';

/**
 * RC's per-entitlement info (design §4's `EntitlementInfo` code block, field-for-field — nothing
 * added, nothing omitted).
 */
export interface EntitlementInfo {
  isActive: boolean;
  willRenew: boolean;
  periodType: EntitlementPeriodType;
  latestPurchaseDate: Date;
  originalPurchaseDate: Date;
  expirationDate: Date | null;
  store: Store;
  /** The `storeProductId` backing this entitlement (design §4). */
  productIdentifier: string;
  unsubscribeDetectedAt: Date | null;
  billingIssueDetectedAt: Date | null;
  ownershipType: OwnershipType;
}

/**
 * One row per `Subscription` in the input, RC-shaped (design §5: "a per-store-product summary
 * array"). Not deduped or filtered by catalog entitlement mapping — this mirrors every store
 * subscription the customer has, whether or not its product has been imported into the catalog.
 */
export interface CustomerInfoSubscription {
  storeProductId: string;
  store: Store;
  isActive: boolean;
  willRenew: boolean;
  expirationDate: Date | null;
  periodType: EntitlementPeriodType;
}

/**
 * The exact object RevenueCat's SDK returns from `getCustomerInfo()` (design §5), computed on read
 * from persisted rows — no scheduler, no materialized cache (design §7).
 */
export interface CustomerInfo {
  entitlements: {
    /** Only entitlements with `isActive === true`. Subset of `all`. */
    active: Record<string, EntitlementInfo>;
    /** Every entitlement identifier the customer has ever held, active or not (design §5). One
     * entry per identifier — see `compute-customer-info.ts` for the active/all dedupe rule. */
    all: Record<string, EntitlementInfo>;
  };
  subscriptions: CustomerInfoSubscription[];
  firstSeen: Date;
  /** `customer.lastSeenAt`, defaulting to `firstSeen` when the customer has never been re-seen
   * (design §5 lists this as a required field, not optional — never `null`/`undefined`). */
  lastSeen: Date;
  /** Best-effort, static store URL — omitted (`undefined`) when not cleanly derivable. Google's
   * needs the app's Play `package` name, which is not part of this engine's input; never guessed. */
  managementURL?: string;
}
