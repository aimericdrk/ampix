import { useSyncExternalStore } from 'react';
import type { AuthUser } from '../../lib/api/types';

export interface AuthState {
  /** Access JWT — memory only, never persisted (contracts §7). */
  accessToken: string | null;
  user: AuthUser | null;
  /** 'unknown' until the first silent-refresh attempt resolves after page load. */
  status: 'unknown' | 'authenticated' | 'anonymous';
}

const INITIAL_STATE: AuthState = { accessToken: null, user: null, status: 'unknown' };

let state: AuthState = INITIAL_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const authStore = {
  getState(): AuthState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setSession(accessToken: string, user: AuthUser): void {
    state = { accessToken, user, status: 'authenticated' };
    emit();
  },
  clearSession(): void {
    state = { accessToken: null, user: null, status: 'anonymous' };
    emit();
  },
  /** Back to the fresh-page-load state ('unknown'). Used by tests and full logout-reload paths. */
  reset(): void {
    state = INITIAL_STATE;
    emit();
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState);
}
