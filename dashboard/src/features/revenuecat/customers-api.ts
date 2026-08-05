import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '../../lib/api/problem';
import { purchaseApiFetch } from '../../lib/api/purchase-client';
import type { RcProductType } from './catalog-api';

/**
 * TanStack Query hooks over the `mobile_purchase` customers API (design
 * `2026-07-20-myrevenuecat-customers-design.md` §2/§7) — the subscriber list + per-customer detail
 * (entitlements, subscriptions, transactions, promotional entitlements) and the admin
 * grant/revoke/refund/delete actions. Every call goes through {@link purchaseApiFetch} (bearer JWT +
 * RFC-7807 → `ApiError`), mirroring `catalog-api.ts`. Query keys are `['rc-customers', projectId, …]`.
 */

// --- List row (§1.3/§7: `GET …/customers` → `{ items: RcCustomerRow[], nextCursor }`) ---

export interface RcCustomerRow {
  id: string;
  appUserId: string;
  createdAt: string;
  lastSeenAt: string | null;
  activeSubscriptionCount: number;
  totalSpentCents: number;
  currency: string | null;
}

export interface RcCustomerList {
  items: RcCustomerRow[];
  nextCursor: string | null;
}

// --- CustomerInfo mirror (§1.2/§1.3 — the extended assembler output; the SDK-facing shape from
// `entitlements/customer-info.types.ts`, wire-shaped: `Date` fields serialize as ISO strings) ---

/** The real store a subscription/transaction came from. */
export type RcStore = 'app_store' | 'play_store';

/** §1.2: a promotionally-sourced `EntitlementInfo.store` reads `'promotional'` instead of a real store. */
export type RcEntitlementStore = RcStore | 'promotional';

export type RcEntitlementPeriodType = 'normal' | 'trial' | 'intro' | 'promo';
export type RcOwnershipType = 'PURCHASED' | 'FAMILY_SHARED';

export interface RcEntitlementInfo {
  isActive: boolean;
  willRenew: boolean;
  periodType: RcEntitlementPeriodType;
  latestPurchaseDate: string;
  originalPurchaseDate: string;
  expirationDate: string | null;
  store: RcEntitlementStore;
  /** §1.2: `'promotional'` for a promotionally-sourced entitlement. */
  productIdentifier: string;
  unsubscribeDetectedAt: string | null;
  billingIssueDetectedAt: string | null;
  ownershipType: RcOwnershipType;
}

export interface RcCustomerInfoSubscription {
  storeProductId: string;
  store: RcStore;
  isActive: boolean;
  willRenew: boolean;
  expirationDate: string | null;
  periodType: RcEntitlementPeriodType;
}

export interface RcCustomerInfo {
  entitlements: {
    /** Only entitlements with `isActive === true`. Subset of `all`. */
    active: Record<string, RcEntitlementInfo>;
    /** Every entitlement identifier the customer has ever held, active or not. */
    all: Record<string, RcEntitlementInfo>;
  };
  subscriptions: RcCustomerInfoSubscription[];
  firstSeen: string;
  lastSeen: string;
  managementURL?: string;
}

// --- Detail sub-types (§1.3: raw `Customer`/`Subscription`/`Transaction` rows + promotional
// entitlements, wire-shaped) ---

export interface RcCustomerDetailCustomer {
  id: string;
  appUserId: string;
  appleAppAccountToken: string | null;
  googleObfuscatedId: string | null;
  attributes: Record<string, unknown> | null;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Raw Prisma `Store` enum, as returned on `Subscription`/`Transaction` rows (uppercase — distinct
 *  from the lowercase `RcStore` the computed `CustomerInfo` uses). */
export type RcRawStore = 'APP_STORE' | 'PLAY_STORE';
export type RcEnvironment = 'SANDBOX' | 'PRODUCTION';
export type RcSubscriptionStatus =
  | 'TRIAL'
  | 'INTRO'
  | 'ACTIVE'
  | 'CANCELLED'
  | 'GRACE_PERIOD'
  | 'BILLING_RETRY'
  | 'PAUSED'
  | 'EXPIRED'
  | 'REVOKED';
export type RcRawPeriodType = 'NORMAL' | 'TRIAL' | 'INTRO' | 'PROMO';

export interface RcSubscriptionRow {
  id: string;
  projectId: string;
  customerId: string;
  appId: string;
  productId: string | null;
  storeProductId: string;
  store: RcRawStore;
  environment: RcEnvironment;
  status: RcSubscriptionStatus;
  periodType: RcRawPeriodType;
  ownershipType: RcOwnershipType;
  originalTransactionId: string | null;
  purchaseToken: string | null;
  purchasedAt: string;
  originalPurchasedAt: string | null;
  expiresAt: string | null;
  autoRenewStatus: boolean;
  autoRenewProductId: string | null;
  unsubscribeDetectedAt: string | null;
  billingIssueDetectedAt: string | null;
  gracePeriodExpiresAt: string | null;
  refundedAt: string | null;
  priceCents: number | null;
  currency: string | null;
  lastEventAt: string | null;
  updatedAt: string;
}

export interface RcTransactionRow {
  id: string;
  projectId: string;
  customerId: string | null;
  appId: string;
  subscriptionId: string | null;
  store: RcRawStore;
  environment: RcEnvironment;
  storeTransactionId: string;
  originalTransactionId: string | null;
  storeProductId: string;
  type: RcProductType;
  purchasedAt: string;
  expiresAt: string | null;
  priceCents: number | null;
  currency: string | null;
  isTrialPeriod: boolean;
  revokedAt: string | null;
  rawPayload: unknown;
  createdAt: string;
}

export interface RcPromotionalEntitlement {
  id: string;
  entitlementIdentifier: string;
  grantedAt: string;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  note: string | null;
}

export interface RcCustomerDetail {
  customer: RcCustomerDetailCustomer;
  customerInfo: RcCustomerInfo;
  subscriptions: RcSubscriptionRow[];
  transactions: RcTransactionRow[];
  promotionalEntitlements: RcPromotionalEntitlement[];
}

// --- Grant input (§1.1's duration set) ---

export type RcPromotionalDuration =
  | 'daily'
  | 'three_day'
  | 'weekly'
  | 'monthly'
  | 'two_month'
  | 'three_month'
  | 'six_month'
  | 'yearly'
  | 'lifetime';

export interface GrantPromotionalEntitlementInput {
  entitlementId: string;
  duration: RcPromotionalDuration;
  note?: string;
}

// --- Query keys & base URL ---

const customersBase = (projectId: string) => `/api/v1/projects/${projectId}/customers`;

/** `['rc-customers', projectId, 'list', search]` (spec §2). */
export function rcCustomersListKey(projectId: string, search: string) {
  return ['rc-customers', projectId, 'list', search] as const;
}

/** `['rc-customers', projectId, 'detail', customerId]` — every mutation invalidates this. */
export function rcCustomerDetailKey(projectId: string, customerId: string) {
  return ['rc-customers', projectId, 'detail', customerId] as const;
}

function invalidateDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  customerId: string,
) {
  void queryClient.invalidateQueries({ queryKey: rcCustomerDetailKey(projectId, customerId) });
}

/** Invalidates every cached list page regardless of `search` (partial key match). */
function invalidateList(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ['rc-customers', projectId, 'list'] });
}

// --- List hook ---

const CUSTOMERS_PAGE_SIZE = 25;

/** Keyset-paginated subscriber list (§1.3: `search` matches `appUserId`, contains, case-insensitive). */
export function useRcCustomers(projectId: string, { search }: { search: string }) {
  return useInfiniteQuery({
    queryKey: rcCustomersListKey(projectId, search),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
      return purchaseApiFetch<RcCustomerList>(
        `${customersBase(projectId)}?search=${encodeURIComponent(search)}&limit=${CUSTOMERS_PAGE_SIZE}${cursor}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

// --- Detail hook ---

export function useRcCustomer(projectId: string, customerId: string) {
  return useQuery({
    queryKey: rcCustomerDetailKey(projectId, customerId),
    queryFn: () => purchaseApiFetch<RcCustomerDetail>(`${customersBase(projectId)}/${customerId}`),
  });
}

// --- Mutations ---

/** `POST …/customers/:customerId/promotional-entitlements` (§1.4) — returns the created grant. */
export function useGrantPromotionalEntitlement(projectId: string, customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GrantPromotionalEntitlementInput) =>
      purchaseApiFetch<RcPromotionalEntitlement>(
        `${customersBase(projectId)}/${customerId}/promotional-entitlements`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
  });
}

/** `DELETE …/customers/:customerId/promotional-entitlements/:grantId` (§1.4) — idempotent revoke. */
export function useRevokePromotionalEntitlement(projectId: string, customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      purchaseApiFetch<void>(
        `${customersBase(projectId)}/${customerId}/promotional-entitlements/${grantId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
  });
}

/** `DELETE …/customers/:customerId` (§1.4) — cascades subs + promo grants; invalidates the detail
 *  AND the list (the row disappears from the list too). */
export function useDeleteCustomer(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) =>
      purchaseApiFetch<void>(`${customersBase(projectId)}/${customerId}`, { method: 'DELETE' }),
    onSuccess: (_data, customerId) => {
      invalidateDetail(queryClient, projectId, customerId);
      invalidateList(queryClient, projectId);
    },
  });
}

/** Refund response (refund design `2026-07-21-myrevenuecat-refund-action-design.md` §1.1 —
 *  the updated subscription's new state; `refundedAt` is an ISO string on the wire). */
export interface RcRefundSubscriptionResult {
  id: string;
  status: 'REVOKED';
  refundedAt: string;
}

/** `POST …/customers/:customerId/subscriptions/:subscriptionId/refund` (refund design §2) —
 *  Google Play refund-last-payment + revoke. Invalidates the detail so the subscription
 *  re-renders as REVOKED/refunded and the entitlement drops. */
export function useRefundSubscription(projectId: string, customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<RcRefundSubscriptionResult, ApiError, string>({
    mutationFn: (subscriptionId: string) =>
      purchaseApiFetch<RcRefundSubscriptionResult>(
        `${customersBase(projectId)}/${customerId}/subscriptions/${subscriptionId}/refund`,
        { method: 'POST' },
      ),
    onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
  });
}
