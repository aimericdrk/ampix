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

// --- Tenancy management (contracts §13) ---

/** Role matrix (contracts §13): admin > analyst > viewer. */
export type OrgRole = 'admin' | 'analyst' | 'viewer';

export const ORG_ROLES: OrgRole[] = ['admin', 'analyst', 'viewer'];

/** An org as seen by the caller, with their own role in it. */
export interface Org {
  id: string;
  name: string;
  role: OrgRole;
}

export interface ListOrgsResponse {
  orgs: Org[];
}

export interface CreateOrgRequest {
  name: string;
}

/** `POST /orgs` — creator becomes admin. */
export type CreateOrgResponse = Org;

export interface RenameOrgRequest {
  name: string;
}

export interface RenameOrgResponse {
  id: string;
  name: string;
}

export interface OrgMemberUser {
  id: string;
  email: string;
  name: string;
}

export interface OrgMember {
  user: OrgMemberUser;
  role: OrgRole;
}

export interface ListMembersResponse {
  members: OrgMember[];
}

export interface UpdateMemberRoleRequest {
  role: OrgRole;
}

export interface CreateInvitationRequest {
  role: OrgRole;
}

/** `POST /orgs/:orgId/invitations` — includes the token; share `invite_path` with the invitee. */
export interface CreateInvitationResponse {
  id: string;
  role: OrgRole;
  token: string;
  invite_path: string;
  expires_at: string;
}

/** A pending invitation as listed by `GET /orgs/:orgId/invitations` — no token exposed. */
export interface Invitation {
  id: string;
  role: OrgRole;
  expires_at: string;
}

export interface ListInvitationsResponse {
  invitations: Invitation[];
}

/** `GET /invitations/:token` (public) — enough to render "invited to X as Y". */
export interface InvitationPreview {
  org_name: string;
  role: OrgRole;
  expires_at: string;
}

export interface AcceptInvitationResponse {
  org_id: string;
  role: OrgRole;
}

export interface CreateProjectRequest {
  name: string;
  timezone?: string;
}

/** `POST /orgs/:orgId/projects` response — no `org_name` (unlike the `Project` list shape). */
export interface CreatedProject {
  id: string;
  org_id: string;
  name: string;
  timezone: string;
  ingest_token: string;
}

export interface UpdateProjectRequest {
  name?: string;
  timezone?: string;
}

export interface UpdateProjectResponse {
  id: string;
  name: string;
  timezone: string;
}

export interface SdkToken {
  id: string;
  token: string;
  label: string;
  created_at: string;
}

export interface ListTokensResponse {
  tokens: SdkToken[];
}

export interface CreateTokenRequest {
  label?: string;
}

/** `POST /projects/:projectId/tokens` response — the new token, shown once. */
export interface CreatedToken {
  id: string;
  token: string;
  label: string;
}

// --- Account (self) management (contracts §13) ---

export interface UpdateNameRequest {
  name: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}
