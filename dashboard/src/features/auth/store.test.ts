import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from './store';

const user = { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' };

describe('authStore', () => {
  beforeEach(() => {
    authStore.reset();
  });

  it('starts unknown with no token', () => {
    expect(authStore.getState()).toEqual({ accessToken: null, user: null, status: 'unknown' });
  });

  it('setSession stores token and user in memory and notifies subscribers', () => {
    const listener = vi.fn();
    authStore.subscribe(listener);
    authStore.setSession('token-123', user);
    expect(authStore.getState()).toEqual({
      accessToken: 'token-123',
      user,
      status: 'authenticated',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    // Never persisted — memory only (contracts §7).
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('clearSession marks the visitor anonymous', () => {
    authStore.setSession('token-123', user);
    authStore.clearSession();
    expect(authStore.getState()).toEqual({ accessToken: null, user: null, status: 'anonymous' });
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = authStore.subscribe(listener);
    unsubscribe();
    authStore.setSession('token-123', user);
    expect(listener).not.toHaveBeenCalled();
  });
});
