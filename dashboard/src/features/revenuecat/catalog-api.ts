import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchaseApiFetch } from '../../lib/api/purchase-client';

/**
 * TanStack Query hooks over the `mobile_purchase` catalog admin API (design
 * `2026-07-18-myrevenuecat-catalog-config-uis-design.md` §2/§9) — the RevenueCat-shaped catalog
 * model: App → Products (attach Entitlements) → Offerings group Packages, each wrapping a Product.
 * Every mutation goes through {@link purchaseApiFetch} (bearer JWT + RFC-7807 → `ApiError`,
 * mirroring `purchaseMetricsBase`/`purchaseApiFetch` from `purchase-metrics-api.ts`) and invalidates
 * its resource's list query on success; §2's two documented cross-invalidations (attaching/detaching
 * an entitlement changes the *products* list; setting the current offering changes the *offerings*
 * list) are handled by invalidating that resource's key directly, since both nest under it.
 */

// --- Apps (§9: `GET …/catalog/apps` → `RcApp[]`; storeCredentials never returned) ---

export type RcAppPlatform = 'IOS' | 'ANDROID' | 'MACOS' | 'AMAZON' | 'WEB';

export interface RcApp {
  id: string;
  name: string;
  platform: RcAppPlatform;
  bundleId?: string | null;
  packageName?: string | null;
  publicSdkKey: string;
  /** Derived on the apps-list response (E4): `storeCredentials !== null`. Never the blob itself.
   *  The per-app connection list reads this so the whole list needs one query. */
  storeConnected?: boolean;
}

export interface CreateRcAppInput {
  name: string;
  platform: RcAppPlatform;
  bundleId?: string;
  packageName?: string;
}

// --- Entitlements (§9: `GET …/catalog/entitlements` → `RcEntitlement[]`) ---

export interface RcEntitlement {
  id: string;
  identifier: string;
  displayName: string;
}

export interface CreateRcEntitlementInput {
  identifier: string;
  displayName: string;
}

/** §1: only `displayName` is editable via `PATCH …/catalog/entitlements/:id`; `identifier` is immutable. */
export interface UpdateRcEntitlementInput {
  displayName: string;
}

// --- Products (§9: `GET …/catalog/products` → `RcProduct[]`, with `entitlements: RcEntitlement[]`) ---

export type RcProductType =
  | 'AUTO_RENEWABLE_SUBSCRIPTION'
  | 'NON_RENEWING_SUBSCRIPTION'
  | 'CONSUMABLE'
  | 'NON_CONSUMABLE';

export interface RcProduct {
  id: string;
  appId: string;
  storeProductId: string;
  type: RcProductType;
  displayName: string;
  priceCents?: number | null;
  currency?: string | null;
  durationIso8601?: string | null;
  subscriptionGroupId?: string | null;
  entitlements: RcEntitlement[];
}

export interface CreateRcProductInput {
  appId: string;
  storeProductId: string;
  type: RcProductType;
  displayName: string;
  priceCents?: number;
  currency?: string;
  durationIso8601?: string;
  subscriptionGroupId?: string;
}

/** §1: editable fields only; `appId`/`storeProductId`/`type` are immutable via `PATCH …/products/:id`. */
export interface UpdateRcProductInput {
  displayName?: string;
  priceCents?: number;
  currency?: string;
  durationIso8601?: string;
  subscriptionGroupId?: string;
}

// --- Offerings & Packages (§9: `GET …/catalog/offerings` → `RcOffering[]`, with `packages: RcPackage[]`) ---

export type RcPackageType =
  | 'UNKNOWN'
  | 'CUSTOM'
  | 'LIFETIME'
  | 'ANNUAL'
  | 'SIX_MONTH'
  | 'THREE_MONTH'
  | 'TWO_MONTH'
  | 'MONTHLY'
  | 'WEEKLY';

export interface RcPackage {
  id: string;
  identifier: string;
  packageType: RcPackageType;
  productId: string;
  sortOrder: number;
}

export interface RcOffering {
  id: string;
  identifier: string;
  displayName: string;
  isCurrent: boolean;
  metadata: unknown;
  packages: RcPackage[];
}

export interface CreateRcOfferingInput {
  identifier: string;
  displayName: string;
  isCurrent?: boolean;
  metadata?: unknown;
}

/** §1: editable fields only; `identifier`/`isCurrent` are immutable via `PATCH …/offerings/:id`
 *  (use `useSetCurrentOffering` for `isCurrent`). */
export interface UpdateRcOfferingInput {
  displayName?: string;
  metadata?: unknown;
}

export interface CreateRcPackageInput {
  identifier: string;
  packageType: RcPackageType;
  productId: string;
  sortOrder?: number;
}

/** §1: editable fields only; `identifier`/`productId` are immutable via
 *  `PATCH …/offerings/:offeringId/packages/:packageId`. */
export interface UpdateRcPackageInput {
  packageType?: RcPackageType;
  sortOrder?: number;
}

// --- Query keys & base URL ---

type RcCatalogResource = 'apps' | 'entitlements' | 'products' | 'offerings';

const catalogBase = (projectId: string) => `/api/v1/projects/${projectId}/catalog`;

/** `['rc-catalog', projectId, <resource>]` (spec §2) — packages have no key of their own since
 *  every package endpoint nests under, and is returned inline with, `offerings`. */
export function rcCatalogKey(projectId: string, resource: RcCatalogResource) {
  return ['rc-catalog', projectId, resource] as const;
}

function invalidateResource(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  resource: RcCatalogResource,
) {
  void queryClient.invalidateQueries({ queryKey: rcCatalogKey(projectId, resource) });
}

// --- Apps hooks ---

export function useRcApps(projectId: string) {
  return useQuery({
    queryKey: rcCatalogKey(projectId, 'apps'),
    queryFn: () => purchaseApiFetch<RcApp[]>(`${catalogBase(projectId)}/apps`),
  });
}

export function useCreateRcApp(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRcAppInput) =>
      purchaseApiFetch<RcApp>(`${catalogBase(projectId)}/apps`, { method: 'POST', body: input }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'apps'),
  });
}

export function useDeleteRcApp(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      purchaseApiFetch<void>(`${catalogBase(projectId)}/apps/${appId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'apps'),
  });
}

// --- Entitlements hooks ---

export function useRcEntitlements(projectId: string) {
  return useQuery({
    queryKey: rcCatalogKey(projectId, 'entitlements'),
    queryFn: () => purchaseApiFetch<RcEntitlement[]>(`${catalogBase(projectId)}/entitlements`),
  });
}

export function useCreateRcEntitlement(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRcEntitlementInput) =>
      purchaseApiFetch<RcEntitlement>(`${catalogBase(projectId)}/entitlements`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'entitlements'),
  });
}

export function useUpdateRcEntitlement(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateRcEntitlementInput) =>
      purchaseApiFetch<RcEntitlement>(`${catalogBase(projectId)}/entitlements/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'entitlements'),
  });
}

export function useDeleteRcEntitlement(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entitlementId: string) =>
      purchaseApiFetch<void>(`${catalogBase(projectId)}/entitlements/${entitlementId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'entitlements'),
  });
}

// --- Products hooks ---

export function useRcProducts(projectId: string) {
  return useQuery({
    queryKey: rcCatalogKey(projectId, 'products'),
    queryFn: () => purchaseApiFetch<RcProduct[]>(`${catalogBase(projectId)}/products`),
  });
}

export function useCreateRcProduct(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRcProductInput) =>
      purchaseApiFetch<RcProduct>(`${catalogBase(projectId)}/products`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
  });
}

export function useUpdateRcProduct(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateRcProductInput) =>
      purchaseApiFetch<RcProduct>(`${catalogBase(projectId)}/products/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
  });
}

export function useDeleteRcProduct(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      purchaseApiFetch<void>(`${catalogBase(projectId)}/products/${productId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
  });
}

/** `POST …/products/:productId/entitlements` (§9: attach returns 204) — cross-invalidates
 *  `products` (its own resource: the change is only visible on the product's `entitlements` array). */
export function useAttachEntitlement(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, entitlementId }: { productId: string; entitlementId: string }) =>
      purchaseApiFetch<void>(`${catalogBase(projectId)}/products/${productId}/entitlements`, {
        method: 'POST',
        body: { entitlementId },
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
  });
}

/** `DELETE …/products/:productId/entitlements/:entitlementId` (§9: detach returns 204). */
export function useDetachEntitlement(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, entitlementId }: { productId: string; entitlementId: string }) =>
      purchaseApiFetch<void>(
        `${catalogBase(projectId)}/products/${productId}/entitlements/${entitlementId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
  });
}

// --- Offerings & Packages hooks ---

export function useRcOfferings(projectId: string) {
  return useQuery({
    queryKey: rcCatalogKey(projectId, 'offerings'),
    queryFn: () => purchaseApiFetch<RcOffering[]>(`${catalogBase(projectId)}/offerings`),
  });
}

export function useCreateRcOffering(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRcOfferingInput) =>
      purchaseApiFetch<RcOffering>(`${catalogBase(projectId)}/offerings`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}

export function useUpdateRcOffering(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateRcOfferingInput) =>
      purchaseApiFetch<RcOffering>(`${catalogBase(projectId)}/offerings/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}

export function useDeleteRcOffering(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offeringId: string) =>
      purchaseApiFetch<void>(`${catalogBase(projectId)}/offerings/${offeringId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}

/** `POST …/offerings/:offeringId/current` (§9/§1: flips the project's single current offering,
 *  204 no body) — invalidates `offerings` so the flip is reflected across the list. */
export function useSetCurrentOffering(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offeringId: string) =>
      purchaseApiFetch<void>(`${catalogBase(projectId)}/offerings/${offeringId}/current`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}

/** `POST …/offerings/:offeringId/packages` — packages are returned inline on `offerings`, so this
 *  invalidates `offerings` rather than a separate packages key. */
export function useAddPackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offeringId, ...body }: { offeringId: string } & CreateRcPackageInput) =>
      purchaseApiFetch<RcPackage>(`${catalogBase(projectId)}/offerings/${offeringId}/packages`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}

export function useUpdatePackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      offeringId,
      packageId,
      ...body
    }: { offeringId: string; packageId: string } & UpdateRcPackageInput) =>
      purchaseApiFetch<RcPackage>(
        `${catalogBase(projectId)}/offerings/${offeringId}/packages/${packageId}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}

/** `DELETE …/offerings/:offeringId/packages/:packageId` (§9: removePackage returns 204). */
export function useRemovePackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offeringId, packageId }: { offeringId: string; packageId: string }) =>
      purchaseApiFetch<void>(
        `${catalogBase(projectId)}/offerings/${offeringId}/packages/${packageId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
  });
}
