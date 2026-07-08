import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'myampix-current-org';

function readPersisted(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persist(orgId: string | null): void {
  try {
    if (orgId) localStorage.setItem(STORAGE_KEY, orgId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only — an unavailable localStorage (private mode, quota) must never break org switching.
  }
}

let state: string | null = readPersisted();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Which organization is "current" for org-scoped UI (projects creation, org
 * settings link). Persisted so a reload keeps the same org selected; the
 * <OrgSwitcher> resets it to a valid choice if the persisted id isn't among
 * the caller's orgs (e.g. a different user, or it was removed).
 */
export const currentOrgStore = {
  getState(): string | null {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setCurrentOrg(orgId: string | null): void {
    state = orgId;
    persist(orgId);
    emit();
  },
  reset(): void {
    currentOrgStore.setCurrentOrg(null);
  },
};

export function useCurrentOrgId(): string | null {
  return useSyncExternalStore(currentOrgStore.subscribe, currentOrgStore.getState);
}
