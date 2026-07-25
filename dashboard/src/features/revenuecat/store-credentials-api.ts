import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '../../lib/api/problem';
import { purchaseApiFetch } from '../../lib/api/purchase-client';
import { rcCatalogKey, type RcAppPlatform } from './catalog-api';

/**
 * TanStack Query hooks over the `mobile_purchase` per-app store-credential endpoints (connect-stores
 * design `2026-07-25-connect-stores-design.md` §1.4/§2) — set / status / disconnect the Google Play
 * service account or Apple App Store Connect key that the self-hosted clone uses to talk to the
 * stores directly. Every call goes through {@link purchaseApiFetch} (bearer JWT + RFC-7807 →
 * `ApiError`), mirroring `catalog-api.ts` / `customers-api.ts`. The secret is NEVER returned — reads
 * are status-only.
 *
 * Status has two sources: the apps-list `storeConnected` boolean (primary, one query per list — see
 * `RcApp`) and this module's per-app `useStoreCredentialStatus` GET, which additionally exposes
 * `liveVerified` + `verifiedAt` for the "Connected · live-verify pending" state and the Manage view.
 * Both mutations invalidate the apps-list query AND the per-app status query on success so whichever
 * the row is reading refetches to the new state.
 */

// --- Status DTO (§1.4: GET status — derived without decrypting; `verifiedAt` is an ISO string
// on the wire) ---

export interface StoreCredentialStatusDto {
  connected: boolean;
  platform: RcAppPlatform;
  liveVerified: boolean;
  verifiedAt: string | null;
}

// --- Blob input types (§1.2: discriminated by the App's platform; ANDROID → google_play,
// IOS → app_store) ---

export interface GooglePlayCredentialInput {
  kind: 'google_play';
  serviceAccountJson: string;
}

export interface AppStoreCredentialInput {
  kind: 'app_store';
  ascIssuerId: string;
  ascKeyId: string;
  ascPrivateKeyP8: string;
  appAppleId: string;
}

export type StoreCredentialInput = GooglePlayCredentialInput | AppStoreCredentialInput;

// --- Query key & base URL ---

const storeCredentialsBase = (projectId: string, appId: string) =>
  `/api/v1/projects/${projectId}/catalog/apps/${appId}/store-credentials`;

/** `['rc-store-credentials', projectId, appId, 'status']` — the per-app status GET; both mutations
 *  invalidate this alongside the apps list. */
export function storeCredentialStatusKey(projectId: string, appId: string) {
  return ['rc-store-credentials', projectId, appId, 'status'] as const;
}

/** Invalidate BOTH status sources: the apps-list `storeConnected` field and the per-app status GET. */
function invalidateStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  appId: string,
) {
  void queryClient.invalidateQueries({ queryKey: rcCatalogKey(projectId, 'apps') });
  void queryClient.invalidateQueries({ queryKey: storeCredentialStatusKey(projectId, appId) });
}

// --- Hooks ---

/** `GET …/apps/:appId/store-credentials/status` (§1.4, viewer) — non-secret status, no decrypt. */
export function useStoreCredentialStatus(projectId: string, appId: string) {
  return useQuery({
    queryKey: storeCredentialStatusKey(projectId, appId),
    queryFn: () =>
      purchaseApiFetch<StoreCredentialStatusDto>(`${storeCredentialsBase(projectId, appId)}/status`),
  });
}

/** `PUT …/apps/:appId/store-credentials` (§1.4, admin) — structural-validate → encrypt → store,
 *  returns the new status (never the secret). 422 structural / 409 platform-mismatch / 503 no-enc-key
 *  / 502 store-rejection all surface as `ApiError`. */
export function useSetStoreCredentials(projectId: string, appId: string) {
  const queryClient = useQueryClient();
  return useMutation<StoreCredentialStatusDto, ApiError, StoreCredentialInput>({
    mutationFn: (input: StoreCredentialInput) =>
      purchaseApiFetch<StoreCredentialStatusDto>(storeCredentialsBase(projectId, appId), {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => invalidateStatus(queryClient, projectId, appId),
  });
}

/** `DELETE …/apps/:appId/store-credentials` (§1.4, admin, 204) — clears the credential; idempotent. */
export function useDisconnectStoreCredentials(projectId: string, appId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      purchaseApiFetch<void>(storeCredentialsBase(projectId, appId), { method: 'DELETE' }),
    onSuccess: () => invalidateStatus(queryClient, projectId, appId),
  });
}
