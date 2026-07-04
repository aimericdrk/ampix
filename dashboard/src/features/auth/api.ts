import { apiFetch } from '../../lib/api/client';
import {
  isMfaRequired,
  type Activate2faRequest,
  type Activate2faResponse,
  type AuthResponse,
  type AuthSuccess,
  type AuthUser,
  type ChangePasswordRequest,
  type Disable2faRequest,
  type LoginRequest,
  type MeResponse,
  type SignupRequest,
  type Setup2faResponse,
  type UpdateNameRequest,
  type Verify2faRequest,
} from '../../lib/api/types';
import { authStore } from './store';

/** Shared TanStack Query key for `GET /auth/me`, used by both Security and Account pages. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

export async function login(input: LoginRequest): Promise<AuthResponse> {
  const response = await apiFetch<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: input,
  });
  // 2FA step-up: no session yet — the challenge screen exchanges mfa_token for one.
  if (!isMfaRequired(response)) authStore.setSession(response.access_token, response.user);
  return response;
}

export async function signup(input: SignupRequest): Promise<AuthSuccess> {
  const response = await apiFetch<AuthSuccess>('/api/v1/auth/signup', {
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

/** Step-up 2FA verify (contracts §11): exchanges mfa_token + a TOTP/recovery code for a real session. */
export async function verify2fa(input: Verify2faRequest): Promise<AuthSuccess> {
  const response = await apiFetch<AuthSuccess>('/api/v1/auth/2fa/verify', {
    method: 'POST',
    body: input,
  });
  authStore.setSession(response.access_token, response.user);
  return response;
}

export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/v1/auth/me');
}

/** Starts enabling 2FA: generates a pending (not-yet-active) secret + QR code. */
export function setup2fa(): Promise<Setup2faResponse> {
  return apiFetch<Setup2faResponse>('/api/v1/auth/2fa/setup', { method: 'POST' });
}

/** Confirms the pending secret with a live code: enables 2FA, returns one-time recovery codes. */
export function activate2fa(input: Activate2faRequest): Promise<Activate2faResponse> {
  return apiFetch<Activate2faResponse>('/api/v1/auth/2fa/activate', {
    method: 'POST',
    body: input,
  });
}

/** Disables 2FA, clearing the secret + recovery codes server-side. */
export function disable2fa(input: Disable2faRequest): Promise<void> {
  return apiFetch<void>('/api/v1/auth/2fa/disable', {
    method: 'POST',
    body: input,
  });
}

// --- Account (self) management (contracts §13) ---

/** Updates the caller's display name; also reflects the change into the in-memory session. */
export async function updateName(input: UpdateNameRequest): Promise<AuthUser> {
  const user = await apiFetch<AuthUser>('/api/v1/auth/me', { method: 'PATCH', body: input });
  authStore.updateUser(user);
  return user;
}

/** Changes the caller's password; wrong `current_password` rejects with 401. */
export function changePassword(input: ChangePasswordRequest): Promise<void> {
  return apiFetch<void>('/api/v1/auth/password', { method: 'POST', body: input });
}
