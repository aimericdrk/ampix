import { apiFetch } from '../../lib/api/client';
import type { AuthResponse, LoginRequest, SignupRequest } from '../../lib/api/types';
import { authStore } from './store';

export async function login(input: LoginRequest): Promise<AuthResponse> {
  const response = await apiFetch<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: input,
  });
  authStore.setSession(response.access_token, response.user);
  return response;
}

export async function signup(input: SignupRequest): Promise<AuthResponse> {
  const response = await apiFetch<AuthResponse>('/api/v1/auth/signup', {
    method: 'POST',
    body: input,
  });
  authStore.setSession(response.access_token, response.user);
  return response;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    // The local session dies even if the server call fails.
    authStore.clearSession();
  }
}
