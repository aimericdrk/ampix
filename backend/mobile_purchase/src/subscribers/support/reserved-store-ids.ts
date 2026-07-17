/** The subset of `App` fields design §3's "app_user_id must not equal the App's own store
 * identifier" rule needs. */
export interface AppStoreIdentifiers {
  publicSdkKey: string;
  bundleId: string | null;
  packageName: string | null;
}

/**
 * Derives the `reservedStoreIds` design §3 requires: an SDK-asserted app_user_id must not equal
 * the owning App's `publicSdkKey`, `bundleId`, or `packageName` (whichever are set — a platform
 * only ever has one of `bundleId`/`packageName`). Passed straight into `assertValidAppUserId` /
 * `CustomersService.getOrCreateCustomer` — without it, that rule silently no-ops (M1 review
 * handoff). Shared by every endpoint that resolves a Customer within an App's scope: M5a's
 * `GET /v1/subscribers/:appUserId` today, M5b's `POST /v1/receipts` next.
 */
export function appReservedStoreIds(app: AppStoreIdentifiers): string[] {
  return [app.publicSdkKey, app.bundleId, app.packageName].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}
