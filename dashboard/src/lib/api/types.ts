// API types per shared contracts §7, §11 (and design spec §14 assumptions).
// Hand-written for phase 1; to be replaced by OpenAPI-generated types with identical names.

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** A resolved session: fresh access token + user, with the refresh cookie set/rotated server-side. */
export interface AuthSuccess {
  access_token: string;
  user: AuthUser;
}

/**
 * Login step-up (contracts §11): 2FA is on for this account, so `/auth/login`
 * returns this instead of a session. `mfa_token` is a short-lived (5 min) JWT
 * that is only ever accepted by `/auth/2fa/verify` — never usable as an access token.
 */
export interface MfaRequired {
  mfa_required: true;
  mfa_token: string;
}

/** `POST /auth/login` returns one of these; every other auth endpoint always resolves AuthSuccess. */
export type AuthResponse = AuthSuccess | MfaRequired;

export function isMfaRequired(response: AuthResponse): response is MfaRequired {
  return 'mfa_required' in response;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}

export interface Project {
  id: string;
  org_id: string;
  /** Added by contracts §12 — the owning organization's display name. */
  org_name: string;
  name: string;
  timezone: string;
  /** Added by contracts §12 — included because the requester owns this project. */
  ingest_token: string;
}

export interface ListProjectsResponse {
  projects: Project[];
}

// --- Projects & minimal analytics read (contracts §12) ---

export interface EventSummaryRow {
  event: string;
  count: number;
}

/** `GET /projects/:projectId/events/summary` — all-time, no date filter in this MVP. */
export interface EventSummaryResponse {
  project_id: string;
  total: number;
  by_event: EventSummaryRow[];
}

// --- Auth & TOTP 2FA (contracts §11) ---

export interface Verify2faRequest {
  mfa_token: string;
  /** A 6-digit TOTP code, or a single-use recovery code. */
  code: string;
}

export interface MeResponse {
  user: AuthUser;
  two_factor_enabled: boolean;
}

/** `POST /2fa/setup` response — a pending, not-yet-active TOTP secret. */
export interface Setup2faResponse {
  otpauth_url: string;
  secret: string;
  /** PNG data URI of the otpauth URL, ready to drop straight into an `<img src>`. */
  qr_data_url: string;
}

export interface Activate2faRequest {
  code: string;
}

export interface Activate2faResponse {
  /** 10 single-use codes, shown exactly once — the server only ever persists hashes. */
  recovery_codes: string[];
}

export interface Disable2faRequest {
  code: string;
}
