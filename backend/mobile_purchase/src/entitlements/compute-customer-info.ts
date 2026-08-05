import type {
  ComputeCustomerInfoInput,
  CustomerInfo,
  CustomerInfoSubscription,
  EntitlementInfo,
  EntitlementPeriodType,
  PromotionalEntitlementProjection,
  Store,
  SubscriptionProjection,
  TransactionProjection,
} from './customer-info.types';

/** RC's static "manage subscriptions" URL for Apple — no per-customer/per-product parameters
 * needed, unlike Google's (which requires the app's Play `package` name — not part of this
 * engine's input, so Google's URL is never derived here; see `computeManagementUrl`). */
const APPLE_MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** Design §4 rule 1: statuses that still carry access, subject to the compute-on-read expiry check. */
const ACTIVE_STATUSES: ReadonlySet<SubscriptionProjection['status']> = new Set([
  'TRIAL',
  'INTRO',
  'ACTIVE',
  'CANCELLED',
  'GRACE_PERIOD',
]);

/** Design §4 rule 2: statuses that never renew, regardless of `autoRenewStatus`. */
const NOT_RENEWING_STATUSES: ReadonlySet<SubscriptionProjection['status']> = new Set([
  'EXPIRED',
  'REVOKED',
  'CANCELLED',
  'PAUSED',
]);

/**
 * Design §4 rule 4's "non-consumable" / "non-renewing" framing, read literally: only these two
 * `ProductType`s can originate a standalone, permanently-active entitlement backing from a
 * `Transaction`. `AUTO_RENEWABLE_SUBSCRIPTION` transactions are already represented by their
 * `Subscription` row (and, in practice, always carry `expiresAt`, so the `expiresAt === null` check
 * below would filter them out anyway); `CONSUMABLE` is explicitly excluded by rule 4's own title — a
 * consumable is not an RC entitlement. Flagged in the report as an interpretive call, not a literal
 * brief instruction (the brief's rule text only spells out the `expiresAt`/`revokedAt` condition).
 */
const LIFETIME_GRANTING_TRANSACTION_TYPES: ReadonlySet<TransactionProjection['type']> = new Set([
  'NON_CONSUMABLE',
  'NON_RENEWING_SUBSCRIPTION',
]);

function mapStore(store: SubscriptionProjection['store']): Store {
  return store === 'APP_STORE' ? 'app_store' : 'play_store';
}

function mapPeriodType(periodType: SubscriptionProjection['periodType']): EntitlementPeriodType {
  switch (periodType) {
    case 'TRIAL':
      return 'trial';
    case 'INTRO':
      return 'intro';
    case 'PROMO':
      return 'promo';
    case 'NORMAL':
    default:
      return 'normal';
  }
}

/** Design §4 rule 1 — compute-on-read `isActive`, never a stored flag. */
function isSubscriptionActive(sub: SubscriptionProjection, nowMs: number): boolean {
  return ACTIVE_STATUSES.has(sub.status) && (sub.expiresAt === null || sub.expiresAt.getTime() > nowMs);
}

/** Design §4 rule 2 — `willRenew`. */
function subscriptionWillRenew(sub: SubscriptionProjection): boolean {
  return sub.autoRenewStatus && !NOT_RENEWING_STATUSES.has(sub.status);
}

function subscriptionToEntitlementInfo(sub: SubscriptionProjection, nowMs: number): EntitlementInfo {
  return {
    isActive: isSubscriptionActive(sub, nowMs),
    willRenew: subscriptionWillRenew(sub),
    periodType: mapPeriodType(sub.periodType),
    latestPurchaseDate: sub.purchasedAt,
    originalPurchaseDate: sub.originalPurchasedAt ?? sub.purchasedAt,
    expirationDate: sub.expiresAt,
    store: mapStore(sub.store),
    productIdentifier: sub.storeProductId,
    unsubscribeDetectedAt: sub.unsubscribeDetectedAt,
    billingIssueDetectedAt: sub.billingIssueDetectedAt,
    // Model gap (flagged in the report): `Subscription` has no `ownershipType` column yet — M2
    // should add one from Apple's decoded `inAppOwnershipType`. Always 'PURCHASED' until then.
    ownershipType: 'PURCHASED',
  };
}

/**
 * Design §4 rule 4 — a `Transaction` only originates a backing when it's a permanent, non-revoked,
 * non-expiring, lifetime-eligible grant. Returns `null` for every other `Transaction` (revoked,
 * still-expiring, or not a lifetime-eligible `type`) — such a transaction contributes NO
 * entitlement at all, not even to `.all` (distinct from an expired *Subscription*, which still
 * appears in `.all` — design §5's active/all split).
 */
function transactionToEntitlementInfo(tx: TransactionProjection): EntitlementInfo | null {
  if (tx.revokedAt !== null) return null;
  if (tx.expiresAt !== null) return null;
  if (!LIFETIME_GRANTING_TRANSACTION_TYPES.has(tx.type)) return null;
  return {
    isActive: true,
    willRenew: false,
    periodType: 'normal',
    latestPurchaseDate: tx.purchasedAt,
    originalPurchaseDate: tx.purchasedAt,
    expirationDate: null,
    store: mapStore(tx.store),
    productIdentifier: tx.storeProductId,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ownershipType: 'PURCHASED',
  };
}

/**
 * Design §1.2 — a promotional grant is "active" purely by its own expiry (no status machine like
 * subscriptions/transactions have): `null` means lifetime (never expires), otherwise strictly
 * after `nowMs`, matching the subscription/transaction compute-on-read boundary (rule 1's `>
 * nowMs`, not `>=`). Revocation is NOT re-checked here — design §1.2 says the engine only ever
 * receives "the customer's non-revoked grants"; the caller (`CustomerInfoAssemblerService`)
 * enforces that with a `revokedAt: null` query before this function is ever called.
 */
function isPromotionalEntitlementActive(grant: PromotionalEntitlementProjection, nowMs: number): boolean {
  return grant.expiresAtMs === null || grant.expiresAtMs > nowMs;
}

/**
 * Design §1.2 — an active promotional grant's `EntitlementInfo`. Promotionally-sourced
 * entitlements carry no store product or renewal, so `productIdentifier`/`store` are the literal
 * `'promotional'` sentinel and `willRenew` is always `false`. The pure input carries no
 * grant/purchase timestamp (the input shape is just `{ entitlementIdentifier, expiresAtMs }`), so
 * `nowMs` — the same reference clock every other compute-on-read decision uses — stands in for
 * both purchase dates; this is a synthesized, not a persisted, timestamp.
 */
function promotionalEntitlementToEntitlementInfo(
  grant: PromotionalEntitlementProjection,
  nowMs: number,
): EntitlementInfo {
  const grantedAsOf = new Date(nowMs);
  return {
    isActive: true,
    willRenew: false,
    periodType: 'normal',
    latestPurchaseDate: grantedAsOf,
    originalPurchaseDate: grantedAsOf,
    expirationDate: grant.expiresAtMs === null ? null : new Date(grant.expiresAtMs),
    store: 'promotional',
    productIdentifier: 'promotional',
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ownershipType: 'PURCHASED',
  };
}

function entitlementIdsFor(input: ComputeCustomerInfoInput, storeProductId: string): readonly string[] {
  // Design §4 rule 5 — a storeProductId absent from the map is an unimported product; the caller
  // (M5) never populates an entry for it, so a missing key IS the "grants nothing" signal.
  return input.entitlementsByStoreProductId.get(storeProductId) ?? [];
}

function addBacking(byEntitlement: Map<string, EntitlementInfo[]>, entitlementId: string, backing: EntitlementInfo): void {
  const existing = byEntitlement.get(entitlementId);
  if (existing) {
    existing.push(backing);
  } else {
    byEntitlement.set(entitlementId, [backing]);
  }
}

/**
 * Design §4 rule 3's dedupe: among active backings, the latest-expiring wins (`null` expiry —
 * lifetime — sorts as "never expires", i.e. always latest); ties go to the most recent
 * `latestPurchaseDate`. When no backing is active, the same ordering picks the most-recently-expired
 * one for `.all`.
 */
function pickWinningBacking(backings: readonly EntitlementInfo[]): EntitlementInfo {
  const activeBackings = backings.filter((backing) => backing.isActive);
  const pool = activeBackings.length > 0 ? activeBackings : backings;
  return pool.reduce((best, candidate) => (compareByRecency(candidate, best) > 0 ? candidate : best));
}

function compareByRecency(a: EntitlementInfo, b: EntitlementInfo): number {
  const aExpiry = a.expirationDate === null ? Number.POSITIVE_INFINITY : a.expirationDate.getTime();
  const bExpiry = b.expirationDate === null ? Number.POSITIVE_INFINITY : b.expirationDate.getTime();
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;
  return a.latestPurchaseDate.getTime() - b.latestPurchaseDate.getTime();
}

function buildSubscriptionsSummary(
  subscriptions: readonly SubscriptionProjection[],
  nowMs: number,
): CustomerInfoSubscription[] {
  return subscriptions.map((sub) => ({
    storeProductId: sub.storeProductId,
    store: mapStore(sub.store),
    isActive: isSubscriptionActive(sub, nowMs),
    willRenew: subscriptionWillRenew(sub),
    expirationDate: sub.expiresAt,
    periodType: mapPeriodType(sub.periodType),
  }));
}

/**
 * Best-effort, static-URL-only (do not invent data). Apple's account-subscriptions URL takes no
 * parameters, so it's always safe to return once the customer has any active App Store
 * subscription. Google's needs the app's Play `package` name, which is not part of this engine's
 * input — omitted (`undefined`) rather than guessed.
 */
function computeManagementUrl(subscriptions: readonly SubscriptionProjection[], nowMs: number): string | undefined {
  const hasActiveAppleSubscription = subscriptions.some(
    (sub) => sub.store === 'APP_STORE' && isSubscriptionActive(sub, nowMs),
  );
  return hasActiveAppleSubscription ? APPLE_MANAGE_SUBSCRIPTIONS_URL : undefined;
}

/**
 * The compute-on-read entitlement engine (design §4/§7): turns a customer's persisted
 * `Subscription`/`Transaction` rows into RevenueCat-shaped `CustomerInfo`. Pure and deterministic —
 * every time-relative decision (`isActive`, `willRenew`) is derived from `nowMs`, never a wall
 * clock, so the same input always produces the same output. M5 (the SDK read API) is the only
 * caller: it loads the rows, resolves the catalog entitlement mapping, and calls this function.
 *
 * @param input the customer + its subscriptions/transactions + the resolved catalog entitlement
 *   mapping (all caller-supplied — this function does no I/O).
 * @param nowMs the reference time, milliseconds since epoch (injected — never `Date.now()`).
 */
export function computeCustomerInfo(input: ComputeCustomerInfoInput, nowMs: number): CustomerInfo {
  const backingsByEntitlement = new Map<string, EntitlementInfo[]>();

  for (const sub of input.subscriptions) {
    const entitlementIds = entitlementIdsFor(input, sub.storeProductId);
    if (entitlementIds.length === 0) continue; // design §4 rule 5 — unimported product
    const backing = subscriptionToEntitlementInfo(sub, nowMs);
    for (const entitlementId of entitlementIds) {
      addBacking(backingsByEntitlement, entitlementId, backing);
    }
  }

  for (const tx of input.transactions) {
    const backing = transactionToEntitlementInfo(tx);
    if (backing === null) continue;
    const entitlementIds = entitlementIdsFor(input, tx.storeProductId);
    if (entitlementIds.length === 0) continue; // design §4 rule 5 — unimported product
    for (const entitlementId of entitlementIds) {
      addBacking(backingsByEntitlement, entitlementId, backing);
    }
  }

  for (const grant of input.promotionalEntitlements) {
    if (!isPromotionalEntitlementActive(grant, nowMs)) continue; // expired — contributes nothing (design §1.2)
    const backing = promotionalEntitlementToEntitlementInfo(grant, nowMs);
    addBacking(backingsByEntitlement, grant.entitlementIdentifier, backing);
  }

  const all: Record<string, EntitlementInfo> = {};
  const active: Record<string, EntitlementInfo> = {};
  for (const [entitlementId, backings] of backingsByEntitlement) {
    const winner = pickWinningBacking(backings);
    all[entitlementId] = winner;
    if (winner.isActive) {
      active[entitlementId] = winner;
    }
  }

  return {
    entitlements: { active, all },
    subscriptions: buildSubscriptionsSummary(input.subscriptions, nowMs),
    firstSeen: input.customer.firstSeenAt,
    lastSeen: input.customer.lastSeenAt ?? input.customer.firstSeenAt,
    managementURL: computeManagementUrl(input.subscriptions, nowMs),
  };
}
