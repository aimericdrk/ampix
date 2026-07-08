import { http, HttpResponse } from 'msw';
import { phase5Handlers, TEMPLATES_FIXTURE } from './phase5-handlers';
import type {
  Activate2faResponse,
  AcceptInvitationResponse,
  AuthResponse,
  AuthUser,
  CreatedProject,
  CreatedToken,
  CreateInvitationResponse,
  CreateOrgResponse,
  CohortDefinition,
  CohortPreviewResponse,
  EngagementResponse,
  EventSummaryResponse,
  ClickHeatmapQuery,
  ClickHeatmapResponse,
  FlowsQueryDefinition,
  FlowsResponse,
  FunnelQueryDefinition,
  FunnelResponse,
  HistogramQuery,
  HistogramResponse,
  ScreenPathsQuery,
  ScreenPathsResponse,
  ScreensResponse,
  Invitation,
  InvitationPreview,
  InsightsQueryDefinition,
  InsightsSeries,
  ListInvitationsResponse,
  RetentionQueryDefinition,
  RetentionResponse,
  RevenueSummaryResponse,
  ListMembersResponse,
  ListOrgsResponse,
  ListProjectsResponse,
  ListTokensResponse,
  ListUsersResponse,
  LiveEvent,
  LiveEventsResponse,
  MeResponse,
  MetaEventsResponse,
  MetaPropertiesResponse,
  MetaPropertyValuesResponse,
  Org,
  OrgRole,
  Project,
  RenameOrgResponse,
  SessionsSummaryResponse,
  Setup2faResponse,
  UpdateProjectResponse,
  UserListItem,
  UserProfileResponse,
} from '../../lib/api/types';

export const TEST_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
};
export const TEST_PASSWORD = 'correct-horse-9';
export const VALID_ACCESS_TOKEN = 'valid-access-token';
export const REFRESHED_ACCESS_TOKEN = 'refreshed-access-token';

/** A fixture user with 2FA already enabled, for exercising the login step-up flow. */
export const MFA_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000002',
  email: 'mfa-user@example.com',
  name: 'Radia Perlman',
};
export const MFA_PASSWORD = 'super-secret-mfa-1';
export const MFA_STEP_UP_TOKEN = 'mfa-step-up-token';
export const MFA_ACCESS_TOKEN = 'mfa-access-token';

/** Fake TOTP: any handler that "checks a code" accepts this constant instead of running RFC 6238. */
export const TOTP_VALID_CODE = '123456';
export const MOCK_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
export const MOCK_QR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/** A single pre-seeded recovery code accepted once by /2fa/verify or /2fa/disable. */
export const MFA_RECOVERY_CODE = 'RECOVERY-CODE-0';

/** Fixture project (contracts §12) — org_name + ingest_token included, requester owns it. */
export const TEST_PROJECT: Project = {
  id: '0197f6a0-0000-7000-8000-0000000000aa',
  org_id: '0197f6a0-0000-7000-8000-0000000000bb',
  org_name: "Ada's Workspace",
  name: 'Demo App',
  timezone: 'UTC',
  ingest_token: 'mam_0123456789abcdef0123456789abcdef',
};

/** Deterministic sample for GET /projects/:projectId/events/summary (contracts §12). */
export const EVENT_SUMMARY_FIXTURE: Omit<EventSummaryResponse, 'project_id'> = {
  total: 52,
  by_event: [
    { event: 'checkout_completed', count: 32 },
    { event: 'product_viewed', count: 20 },
  ],
};

// --- Core analytics fixtures (contracts §14) ---

export const META_EVENTS_FIXTURE: MetaEventsResponse = {
  events: ['checkout_completed', 'product_viewed', 'app_opened', 'signup_completed'],
};

export const META_PROPERTIES_FIXTURE: MetaPropertiesResponse = {
  properties: [
    { name: 'os', type: 'column' },
    { name: 'app_version', type: 'column' },
    { name: 'utm_source', type: 'column' },
    { name: 'plan', type: 'string' },
  ],
};

/**
 * Suggested values for the filter-value type-ahead (GET /meta/property-values). Any suggestable
 * property returns this small frequency-ranked list; the handler returns `[]` for the designated
 * free-form key (`email`) so the format-example hint fallback can be exercised.
 */
export const META_PROPERTY_VALUES_FIXTURE: MetaPropertyValuesResponse = {
  values: ['free', 'pro', 'enterprise'],
};

/** Per-property overrides of the generic fixture above, for properties whose real values matter. */
const PROPERTY_VALUES_BY_KEY: Record<string, string[]> = {
  os: ['ios', 'android'],
};

/** Property keys that have no useful autosuggest — the endpoint returns an empty list for them. */
const FREE_FORM_PROPERTY_KEYS = new Set(['email']);

/**
 * Deterministic newest-first fixture for GET /events/live — evt-30 is the newest. 30 (> the UI's
 * 25-per-page request) so tests exercise real "load older" pagination via `next_before`.
 */
export const LIVE_EVENTS_FIXTURE: LiveEvent[] = Array.from({ length: 30 }, (_, i) => {
  const n = 30 - i;
  return {
    insert_id: `evt-${n}`,
    event: n % 2 === 0 ? 'checkout_completed' : 'product_viewed',
    distinct_id: `user-00${((n - 1) % 5) + 1}`,
    timestamp: `2026-07-02T12:${String(n).padStart(2, '0')}:00.000Z`,
    os: n % 2 === 0 ? 'Android' : 'iOS',
    app_version: n >= 15 ? '2.0.0' : '1.4.0',
  };
});

/**
 * Deterministic fixture for GET /users, GET /users/:distinctId — ordered by distinct_id. 22 users
 * (> the UI's 20-per-page request) so tests exercise real "load more" pagination via
 * `next_cursor`. `user-001` carries the detailed values GET /users/:distinctId (below) responds
 * with. `user-001`/`user-002` share a "alex" name substring so a name search surfaces a real
 * disambiguation table (P4-T3); `user-005` has no profile name/email to exercise the `'—'` /
 * distinct_id fallbacks.
 */
export const USERS_FIXTURE: UserListItem[] = [
  {
    distinct_id: 'user-001',
    last_seen: '2026-07-01T10:00:00.000Z',
    event_count: 42,
    name: 'Alex Chen',
    email: 'alex.chen@example.com',
  },
  {
    distinct_id: 'user-002',
    last_seen: '2026-06-30T09:30:00.000Z',
    event_count: 17,
    name: 'Alex Wong',
    email: 'alex.wong@example.com',
  },
  {
    distinct_id: 'user-003',
    last_seen: '2026-06-29T08:15:00.000Z',
    event_count: 5,
    name: 'Priya Singh',
    email: 'priya@example.com',
  },
  {
    distinct_id: 'user-004',
    last_seen: '2026-06-28T07:00:00.000Z',
    event_count: 63,
    name: 'Jordan Lee',
    email: 'jordan@example.com',
  },
  {
    distinct_id: 'user-005',
    last_seen: '2026-06-27T06:45:00.000Z',
    event_count: 9,
    name: null,
    email: null,
  },
  ...Array.from({ length: 17 }, (_, i) => {
    const n = i + 6;
    return {
      distinct_id: `user-${String(n).padStart(3, '0')}`,
      last_seen: `2026-06-${String(26 - i).padStart(2, '0')}T06:00:00.000Z`,
      event_count: n,
      name: `User ${n}`,
      email: `user${n}@example.com`,
    };
  }),
];

export const USER_PROFILE_FIXTURE: Omit<
  UserProfileResponse,
  'distinct_id' | 'last_seen' | 'event_count'
> = {
  profile: { plan: 'pro', email: 'user001@example.com', country: 'FR' },
  first_seen: '2026-05-01T08:00:00.000Z',
  // Newest-first. The $screen_view rows drive the screen-path chain: chronologically
  // home → catalog → catalog → cart, collapsing to home → catalog → cart. Non-screen events carry
  // a null screen_name.
  recent_events: [
    { insert_id: 'evt-106', event: 'checkout_completed', timestamp: '2026-07-01T10:00:00.000Z', screen_name: null },
    { insert_id: 'evt-105', event: '$screen_view', timestamp: '2026-07-01T09:58:00.000Z', screen_name: 'cart' },
    { insert_id: 'evt-104', event: '$screen_view', timestamp: '2026-07-01T09:56:00.000Z', screen_name: 'catalog' },
    { insert_id: 'evt-103', event: '$screen_view', timestamp: '2026-07-01T09:54:00.000Z', screen_name: 'catalog' },
    { insert_id: 'evt-102', event: '$screen_view', timestamp: '2026-07-01T09:52:00.000Z', screen_name: 'home' },
    { insert_id: 'evt-101', event: 'app_opened', timestamp: '2026-07-01T09:50:00.000Z', screen_name: null },
  ],
  // §17 identity set — canonical id + an aliased anon_id — for the identity-correct per-user heatmap.
  distinct_ids: ['user-001', 'anon-001'],
};

export const SESSIONS_SUMMARY_FIXTURE: SessionsSummaryResponse = {
  sessions: 128,
  avg_duration_ms: 245000,
  by_day: [
    { t: '2026-06-29', sessions: 40, avg_duration_ms: 230000 },
    { t: '2026-06-30', sessions: 44, avg_duration_ms: 250000 },
    { t: '2026-07-01', sessions: 44, avg_duration_ms: 255000 },
  ],
};

/** Deterministic sample for `GET /metrics/revenue` (contracts §19): $480 over 40 purchases, 30
 *  paying users — arppu = 480/30 = $16, avg_purchase_value = 480/40 = $12, both exact. */
export const REVENUE_SUMMARY_FIXTURE: RevenueSummaryResponse = {
  total_revenue: 480,
  purchases: 40,
  paying_users: 30,
  arppu: 16,
  avg_purchase_value: 12,
  by_day: [
    { t: '2026-06-29', revenue: 150, purchases: 12 },
    { t: '2026-06-30', revenue: 160, purchases: 14 },
    { t: '2026-07-01', revenue: 170, purchases: 14 },
  ],
  by_product: [
    { product_id: 'pro_monthly', revenue: 300, purchases: 25 },
    { product_id: 'coins_pack', revenue: 180, purchases: 15 },
  ],
};

/**
 * Deterministic sample for `POST /query/histogram` (feat-09 §3.1): 3 adaptive buckets summing to
 * 75 (40 + 25 + 10), so a fixed 50/33.3/13.3-ish split is assertable in the table's `%` column.
 */
export const HISTOGRAM_FIXTURE: HistogramResponse = {
  buckets: [
    { lower: 0, upper: 5000, count: 40 },
    { lower: 5000, upper: 10000, count: 25 },
    { lower: 10000, upper: 15000, count: 10 },
  ],
  total: 75,
  min: 500,
  max: 14800,
  mean: 6200,
  p50: 5200,
  p90: 12000,
};

// --- Advanced analysis fixtures (contracts §15) ---

/** Deterministic funnel used by the default handler when a test does not override it. */
export const FUNNEL_FIXTURE: FunnelResponse = {
  steps: [
    { event: 'app_open', count: 1000, conversion_from_prev: 1, conversion_from_top: 1 },
    { event: 'signup_started', count: 620, conversion_from_prev: 0.62, conversion_from_top: 0.62 },
    { event: 'checkout_completed', count: 145, conversion_from_prev: 0.234, conversion_from_top: 0.145 },
  ],
  overall_conversion: 0.145,
};

/** Two cohorts + a size-weighted averages row (period 1 avg = (320*0.65 + 180*0.5)/500 = 0.596). */
export const RETENTION_FIXTURE: RetentionResponse = {
  cohorts: [
    {
      cohort: '2026-06-01',
      size: 320,
      periods: [
        { period: 0, count: 320, rate: 1 },
        { period: 1, count: 208, rate: 0.65 },
        { period: 2, count: 112, rate: 0.35 },
      ],
    },
    {
      cohort: '2026-06-02',
      size: 180,
      periods: [
        { period: 0, count: 180, rate: 1 },
        { period: 1, count: 90, rate: 0.5 },
      ],
    },
  ],
  averages: [
    { period: 0, rate: 1 },
    { period: 1, rate: 0.596 },
    { period: 2, rate: 0.35 },
  ],
};

/** A two-step forward flow with an $end drop-off and an $other fold. */
export const FLOWS_FIXTURE: FlowsResponse = {
  nodes: [
    { id: '0:app_open', step: 0, event: 'app_open', value: 1000 },
    { id: '1:browse', step: 1, event: 'browse', value: 540 },
    { id: '1:$other', step: 1, event: '$other', value: 160 },
    { id: '1:$end', step: 1, event: '$end', value: 300 },
  ],
  links: [
    { source: '0:app_open', target: '1:browse', value: 540 },
    { source: '0:app_open', target: '1:$other', value: 160 },
    { source: '0:app_open', target: '1:$end', value: 300 },
  ],
};

/** Small deterministic engagement fixture: 3 daily buckets of DAU + stickiness + new/returning. */
export const ENGAGEMENT_FIXTURE: EngagementResponse = {
  active: [
    { t: '2026-06-29', metric: 'dau', value: 120 },
    { t: '2026-06-30', metric: 'dau', value: 135 },
    { t: '2026-07-01', metric: 'dau', value: 150 },
  ],
  stickiness: [
    { t: '2026-06-29', value: 0.24 },
    { t: '2026-06-30', value: 0.27 },
    { t: '2026-07-01', value: 0.3 },
  ],
  new_vs_returning: [
    { t: '2026-06-29', new: 30, returning: 90 },
    { t: '2026-06-30', new: 35, returning: 100 },
    { t: '2026-07-01', new: 40, returning: 110 },
  ],
};

// --- Screens, user-path map & click heatmap fixtures (contracts §18/§19) ---

export const SCREENS_FIXTURE: ScreensResponse = {
  screens: [
    { screen_name: 'home', capture_count: 3, latest_captured_at: '2026-07-01T10:00:00Z', width: 390, height: 844, latest_image_hash: 'hash-home', latest_app_version: '1.0.0' },
    { screen_name: 'catalog', capture_count: 2, latest_captured_at: '2026-07-01T10:05:00Z', width: 390, height: 844, latest_image_hash: 'hash-catalog', latest_app_version: '1.0.0' },
    { screen_name: 'checkout', capture_count: 1, latest_captured_at: '2026-07-01T10:10:00Z', width: 390, height: 844, latest_image_hash: 'hash-checkout', latest_app_version: '1.0.0' },
  ],
};

/** Same Sankey shape as §15 flows, but nodes are screens (`$screen_name`). */
export const SCREEN_PATHS_FIXTURE: ScreenPathsResponse = {
  nodes: [
    { id: '0:home', step: 0, event: 'home', value: 1000 },
    { id: '1:catalog', step: 1, event: 'catalog', value: 620 },
    { id: '1:$end', step: 1, event: '$end', value: 380 },
    { id: '2:checkout', step: 2, event: 'checkout', value: 240 },
  ],
  links: [
    { source: '0:home', target: '1:catalog', value: 620 },
    { source: '0:home', target: '1:$end', value: 380 },
    { source: '1:catalog', target: '2:checkout', value: 240 },
  ],
};

export const CLICK_HEATMAP_FIXTURE: ClickHeatmapResponse = {
  screen_name: 'checkout',
  total: 87,
  cells: [
    { cx: 2, cy: 5, count: 42 },
    { cx: 8, cy: 30, count: 25 },
    { cx: 15, cy: 38, count: 20 },
  ],
};

/** A tiny opaque PNG-ish byte payload — enough for `Response.blob()`; not decoded in jsdom. */
export const SCREEN_IMAGE_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

interface Fixture {
  user: AuthUser;
  password: string;
}

const FIXTURES: Fixture[] = [
  { user: TEST_USER, password: TEST_PASSWORD },
  { user: MFA_USER, password: MFA_PASSWORD },
];

function findFixture(email?: string, password?: string): Fixture | undefined {
  return FIXTURES.find((fixture) => fixture.user.email === email && fixture.password === password);
}

/** access token -> the fixture user it belongs to, for /me and the 2FA-management endpoints. */
const TOKEN_USERS: Record<string, AuthUser> = {
  [VALID_ACCESS_TOKEN]: TEST_USER,
  [REFRESHED_ACCESS_TOKEN]: TEST_USER,
  [MFA_ACCESS_TOKEN]: MFA_USER,
};

function userForToken(token: string | null): AuthUser | null {
  if (!token) return null;
  const base = TOKEN_USERS[token];
  if (!base) return null;
  // Reflects a PATCH /auth/me rename without mutating the shared fixture constant.
  const overrideName = orgsState.userNames.get(base.id);
  return overrideName ? { ...base, name: overrideName } : base;
}

/** Mutable mock-server state; reset between tests via resetAuthState(). */
export const authState = {
  /** Simulates whether the browser holds a valid httpOnly refresh cookie. */
  refreshValid: false,
  refreshCalls: 0,
  knownEmails: new Set<string>([TEST_USER.email, MFA_USER.email]),
  /** Emails with 2FA currently ON. MFA_USER starts enabled; TEST_USER starts disabled. */
  twoFactorEnabled: new Set<string>([MFA_USER.email]),
  /** Pending (not-yet-active) TOTP secret per email, set by /2fa/setup, cleared by /2fa/activate. */
  pendingSecret: new Map<string, string>(),
  /** Unused recovery codes per email — single-use, consumed by /2fa/verify or /2fa/disable. */
  recoveryCodes: new Map<string, Set<string>>([[MFA_USER.email, new Set([MFA_RECOVERY_CODE])]]),
  /** Current password per email — mutable so POST /auth/password can be verified end-to-end. */
  passwords: new Map<string, string>([
    [TEST_USER.email, TEST_PASSWORD],
    [MFA_USER.email, MFA_PASSWORD],
  ]),
};

export function resetAuthState(): void {
  authState.refreshValid = false;
  authState.refreshCalls = 0;
  authState.knownEmails = new Set([TEST_USER.email, MFA_USER.email]);
  authState.twoFactorEnabled = new Set([MFA_USER.email]);
  authState.pendingSecret = new Map();
  authState.recoveryCodes = new Map([[MFA_USER.email, new Set([MFA_RECOVERY_CODE])]]);
  authState.passwords = new Map([
    [TEST_USER.email, TEST_PASSWORD],
    [MFA_USER.email, MFA_PASSWORD],
  ]);
}

function problem(status: number, title: string, extra?: Record<string, unknown>) {
  return HttpResponse.json(
    { type: 'about:blank', title, status, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const ACCEPTED_TOKENS = new Set(Object.keys(TOKEN_USERS));

/** Accepts the fake TOTP code, or a still-unused recovery code (consuming it). */
function checkCode(email: string, code: string | undefined): boolean {
  if (!code) return false;
  if (code === TOTP_VALID_CODE) return true;
  const codes = authState.recoveryCodes.get(email);
  if (codes?.has(code)) {
    codes.delete(code);
    return true;
  }
  return false;
}

// --- Tenancy management fixtures (contracts §13) ---

/** Ada's Workspace — TEST_USER is admin, MFA_USER is analyst. Matches TEST_PROJECT.org_id/org_name. */
export const TEST_ORG_ID = TEST_PROJECT.org_id;
export const TEST_ORG_NAME = TEST_PROJECT.org_name;

/** A second org where TEST_USER is only a viewer — used to test role-gated UI. */
export const VIEWER_ORG_ID = '0197f6a0-0000-7000-8000-0000000000cc';
export const VIEWER_ORG_NAME = 'Read-Only Co';

/**
 * A third org neither fixture user belongs to yet — the target of the fixed invitation below, so
 * accepting it exercises real membership creation rather than the "already a member" no-op path.
 */
export const INVITE_ONLY_ORG_ID = '0197f6a0-0000-7000-8000-0000000000dd';
export const INVITE_ONLY_ORG_NAME = 'New Client Co';

/** A fixed, never-expired invitation token for the invite-accept happy-path tests. */
export const FIXED_INVITE_TOKEN = 'fixed-invite-token-abc123';
export const FIXED_INVITE_ROLE: OrgRole = 'analyst';

interface MembershipRecord {
  orgId: string;
  user: AuthUser;
  role: OrgRole;
}

interface OrgRecord {
  id: string;
  name: string;
}

interface InvitationRecord {
  id: string;
  orgId: string;
  role: OrgRole;
  token: string;
  expiresAt: string;
  acceptedBy: string | null;
}

interface ProjectRecord {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
}

interface TokenRecord {
  id: string;
  projectId: string;
  token: string;
  label: string;
  createdAt: string;
  revoked: boolean;
}

function futureIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function initialOrgsState() {
  return {
    orgs: [
      { id: TEST_ORG_ID, name: TEST_ORG_NAME },
      { id: VIEWER_ORG_ID, name: VIEWER_ORG_NAME },
      { id: INVITE_ONLY_ORG_ID, name: INVITE_ONLY_ORG_NAME },
    ] as OrgRecord[],
    memberships: [
      { orgId: TEST_ORG_ID, user: TEST_USER, role: 'admin' as OrgRole },
      { orgId: TEST_ORG_ID, user: MFA_USER, role: 'analyst' as OrgRole },
      { orgId: VIEWER_ORG_ID, user: TEST_USER, role: 'viewer' as OrgRole },
      { orgId: VIEWER_ORG_ID, user: MFA_USER, role: 'admin' as OrgRole },
    ] as MembershipRecord[],
    invitations: [
      {
        id: 'invitation-fixed-1',
        orgId: INVITE_ONLY_ORG_ID,
        role: FIXED_INVITE_ROLE,
        token: FIXED_INVITE_TOKEN,
        expiresAt: futureIso(7),
        acceptedBy: null,
      },
    ] as InvitationRecord[],
    projects: [
      {
        id: TEST_PROJECT.id,
        orgId: TEST_PROJECT.org_id,
        name: TEST_PROJECT.name,
        timezone: TEST_PROJECT.timezone,
      },
    ] as ProjectRecord[],
    tokens: [
      {
        id: 'token-1',
        projectId: TEST_PROJECT.id,
        token: TEST_PROJECT.ingest_token,
        label: 'Default',
        createdAt: futureIso(-30),
        revoked: false,
      },
    ] as TokenRecord[],
    /** Display-name overrides from PATCH /auth/me, keyed by user id. */
    userNames: new Map<string, string>(),
    nextId: 1,
  };
}

export const orgsState = initialOrgsState();

export function resetOrgsState(): void {
  const fresh = initialOrgsState();
  orgsState.orgs = fresh.orgs;
  orgsState.memberships = fresh.memberships;
  orgsState.invitations = fresh.invitations;
  orgsState.projects = fresh.projects;
  orgsState.tokens = fresh.tokens;
  orgsState.userNames = fresh.userNames;
  orgsState.nextId = fresh.nextId;
}

function nextId(prefix: string): string {
  orgsState.nextId += 1;
  return `${prefix}-${orgsState.nextId}`;
}

function generateToken(): string {
  let hex = '';
  for (let i = 0; i < 32; i += 1) hex += Math.floor(Math.random() * 16).toString(16);
  return `mam_${hex}`;
}

function membershipsFor(userId: string): MembershipRecord[] {
  return orgsState.memberships.filter((m) => m.user.id === userId);
}

function roleFor(orgId: string, userId: string): OrgRole | undefined {
  return orgsState.memberships.find((m) => m.orgId === orgId && m.user.id === userId)?.role;
}

function adminCount(orgId: string): number {
  return orgsState.memberships.filter((m) => m.orgId === orgId && m.role === 'admin').length;
}

function orgById(orgId: string): OrgRecord | undefined {
  return orgsState.orgs.find((o) => o.id === orgId);
}

function projectRecordById(projectId: string): ProjectRecord | undefined {
  return orgsState.projects.find((p) => p.id === projectId);
}

/** The requester's `ingest_token` for a project — its earliest non-revoked token. */
function ingestTokenFor(projectId: string): string {
  const active = orgsState.tokens.find((t) => t.projectId === projectId && !t.revoked);
  return active?.token ?? '';
}

function toProject(record: ProjectRecord): Project {
  const org = orgById(record.orgId);
  return {
    id: record.id,
    org_id: record.orgId,
    org_name: org?.name ?? '',
    name: record.name,
    timezone: record.timezone,
    ingest_token: ingestTokenFor(record.id),
  };
}

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    const fixture = findFixture(body.email, body.password);
    if (!fixture) return problem(401, 'Invalid email or password');

    if (authState.twoFactorEnabled.has(fixture.user.email)) {
      // No access token, no refresh cookie — just the short-lived mfa_token (contracts §11).
      const response: AuthResponse = { mfa_required: true, mfa_token: MFA_STEP_UP_TOKEN };
      return HttpResponse.json(response);
    }

    authState.refreshValid = true; // server Set-Cookie's the refresh token
    const token = fixture.user === MFA_USER ? MFA_ACCESS_TOKEN : VALID_ACCESS_TOKEN;
    const response: AuthResponse = { access_token: token, user: fixture.user };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/signup', async ({ request }) => {
    const body = (await request.json()) as { name?: string; email?: string; password?: string };
    if (!body.email || !body.password || !body.name) {
      return problem(400, 'Validation failed', {
        errors: { email: ['required'], password: ['required'], name: ['required'] },
      });
    }
    if (authState.knownEmails.has(body.email)) {
      return problem(409, 'Email already registered');
    }
    authState.knownEmails.add(body.email);
    authState.refreshValid = true;
    const response: AuthResponse = {
      access_token: VALID_ACCESS_TOKEN,
      user: { ...TEST_USER, email: body.email, name: body.name },
    };
    return HttpResponse.json(response); // 200, per contracts §7 (same as login/refresh)
  }),

  http.post('/api/v1/auth/refresh', () => {
    authState.refreshCalls += 1;
    if (!authState.refreshValid) return problem(401, 'Refresh token invalid or expired');
    const response: AuthResponse = { access_token: REFRESHED_ACCESS_TOKEN, user: TEST_USER };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/logout', () => {
    authState.refreshValid = false;
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Auth & TOTP 2FA (contracts §11) ---

  http.post('/api/v1/auth/2fa/verify', async ({ request }) => {
    const body = (await request.json()) as { mfa_token?: string; code?: string };
    if (body.mfa_token !== MFA_STEP_UP_TOKEN) {
      return problem(401, 'Session expired, please log in again');
    }
    if (!checkCode(MFA_USER.email, body.code)) {
      return problem(401, 'Invalid authentication code');
    }
    authState.refreshValid = true;
    const response: AuthResponse = { access_token: MFA_ACCESS_TOKEN, user: MFA_USER };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/auth/me', ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const response: MeResponse = {
      user,
      two_factor_enabled: authState.twoFactorEnabled.has(user.email),
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/2fa/setup', ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    authState.pendingSecret.set(user.email, MOCK_TOTP_SECRET);
    const response: Setup2faResponse = {
      otpauth_url: `otpauth://totp/MyAmpMix:${encodeURIComponent(user.email)}?secret=${MOCK_TOTP_SECRET}&issuer=MyAmpMix`,
      secret: MOCK_TOTP_SECRET,
      qr_data_url: MOCK_QR_DATA_URL,
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/2fa/activate', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { code?: string };
    const pending = authState.pendingSecret.get(user.email);
    if (!pending || body.code !== TOTP_VALID_CODE) {
      return problem(401, 'Invalid authentication code');
    }
    authState.pendingSecret.delete(user.email);
    authState.twoFactorEnabled.add(user.email);
    const codes = Array.from({ length: 10 }, (_, i) => `RECOVERY-CODE-${i}`);
    authState.recoveryCodes.set(user.email, new Set(codes));
    const response: Activate2faResponse = { recovery_codes: codes };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/2fa/disable', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { code?: string };
    if (!checkCode(user.email, body.code)) {
      return problem(401, 'Invalid authentication code');
    }
    authState.twoFactorEnabled.delete(user.email);
    authState.recoveryCodes.delete(user.email);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Account (self) management (contracts §13) ---

  http.patch('/api/v1/auth/me', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) {
      return problem(400, 'Validation failed', { errors: { name: ['required'] } });
    }
    orgsState.userNames.set(user.id, body.name.trim());
    const updated: AuthUser = { ...user, name: body.name.trim() };
    return HttpResponse.json(updated);
  }),

  http.post('/api/v1/auth/password', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { current_password?: string; new_password?: string };
    const stored = authState.passwords.get(user.email);
    if (!body.current_password || body.current_password !== stored) {
      return problem(401, 'Current password is incorrect');
    }
    if (!body.new_password || body.new_password.length < 8) {
      return problem(400, 'Validation failed', {
        errors: { new_password: ['must be at least 8 characters'] },
      });
    }
    authState.passwords.set(user.email, body.new_password);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Organizations (contracts §13) ---

  http.post('/api/v1/orgs', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) {
      return problem(400, 'Validation failed', { errors: { name: ['required'] } });
    }
    const org: OrgRecord = { id: nextId('org'), name: body.name.trim() };
    orgsState.orgs.push(org);
    orgsState.memberships.push({ orgId: org.id, user, role: 'admin' });
    const response: CreateOrgResponse = { id: org.id, name: org.name, role: 'admin' };
    return HttpResponse.json(response, { status: 201 });
  }),

  http.get('/api/v1/orgs', ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const orgs: Org[] = membershipsFor(user.id).map((m) => {
      const org = orgById(m.orgId);
      return { id: m.orgId, name: org?.name ?? '', role: m.role };
    });
    const response: ListOrgsResponse = { orgs };
    return HttpResponse.json(response);
  }),

  http.patch('/api/v1/orgs/:orgId', async ({ request, params }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    const org = orgById(orgId);
    if (!org) return problem(404, 'Organization not found');
    const role = roleFor(orgId, user.id);
    if (!role) return problem(403, 'Not a member of this organization');
    if (role !== 'admin') return problem(403, 'Only admins can rename the organization');
    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) {
      return problem(400, 'Validation failed', { errors: { name: ['required'] } });
    }
    org.name = body.name.trim();
    const response: RenameOrgResponse = { id: org.id, name: org.name };
    return HttpResponse.json(response);
  }),

  // --- Members & permissions (contracts §13) ---

  http.get('/api/v1/orgs/:orgId/members', ({ request, params }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    if (!roleFor(orgId, user.id)) return problem(403, 'Not a member of this organization');
    const response: ListMembersResponse = {
      members: orgsState.memberships
        .filter((m) => m.orgId === orgId)
        .map((m) => ({ user: m.user, role: m.role })),
    };
    return HttpResponse.json(response);
  }),

  http.patch('/api/v1/orgs/:orgId/members/:userId', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    const targetUserId = params.userId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can change member roles');
    const membership = orgsState.memberships.find(
      (m) => m.orgId === orgId && m.user.id === targetUserId,
    );
    if (!membership) return problem(404, 'Member not found');
    const body = (await request.json()) as { role?: OrgRole };
    if (!body.role) return problem(400, 'Validation failed', { errors: { role: ['required'] } });
    if (membership.role === 'admin' && body.role !== 'admin' && adminCount(orgId) <= 1) {
      return problem(409, 'Cannot demote the last admin');
    }
    membership.role = body.role;
    // apiFetch always parses non-204 responses as JSON — an empty body would throw client-side.
    return HttpResponse.json({ id: membership.user.id, role: membership.role });
  }),

  http.delete('/api/v1/orgs/:orgId/members/:userId', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    const targetUserId = params.userId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can remove members');
    const membership = orgsState.memberships.find(
      (m) => m.orgId === orgId && m.user.id === targetUserId,
    );
    if (!membership) return problem(404, 'Member not found');
    if (membership.role === 'admin' && adminCount(orgId) <= 1) {
      return problem(409, 'Cannot remove the last admin');
    }
    orgsState.memberships = orgsState.memberships.filter(
      (m) => !(m.orgId === orgId && m.user.id === targetUserId),
    );
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Invitations (contracts §13) ---

  http.post('/api/v1/orgs/:orgId/invitations', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can create invitations');
    const body = (await request.json()) as { role?: OrgRole };
    if (!body.role) return problem(400, 'Validation failed', { errors: { role: ['required'] } });
    const invitation: InvitationRecord = {
      id: nextId('invitation'),
      orgId,
      role: body.role,
      token: nextId('invite-token'),
      expiresAt: futureIso(7),
      acceptedBy: null,
    };
    orgsState.invitations.push(invitation);
    const response: CreateInvitationResponse = {
      id: invitation.id,
      role: invitation.role,
      token: invitation.token,
      invite_path: `/invite/${invitation.token}`,
      expires_at: invitation.expiresAt,
    };
    return HttpResponse.json(response, { status: 201 });
  }),

  http.get('/api/v1/orgs/:orgId/invitations', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can list invitations');
    const now = Date.now();
    const invitations: Invitation[] = orgsState.invitations
      .filter(
        (inv) => inv.orgId === orgId && !inv.acceptedBy && new Date(inv.expiresAt).getTime() > now,
      )
      .map((inv) => ({ id: inv.id, role: inv.role, expires_at: inv.expiresAt }));
    const response: ListInvitationsResponse = { invitations };
    return HttpResponse.json(response);
  }),

  http.delete('/api/v1/orgs/:orgId/invitations/:invitationId', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can revoke invitations');
    const invitationId = params.invitationId as string;
    const exists = orgsState.invitations.some(
      (inv) => inv.id === invitationId && inv.orgId === orgId,
    );
    if (!exists) return problem(404, 'Invitation not found');
    orgsState.invitations = orgsState.invitations.filter((inv) => inv.id !== invitationId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/invitations/:token', ({ params }) => {
    const token = params.token as string;
    const invitation = orgsState.invitations.find((inv) => inv.token === token);
    if (!invitation) return problem(404, 'Invitation not found');
    if (invitation.acceptedBy || new Date(invitation.expiresAt).getTime() <= Date.now()) {
      return problem(410, 'This invitation has expired or has already been used');
    }
    const org = orgById(invitation.orgId);
    const response: InvitationPreview = {
      org_name: org?.name ?? '',
      role: invitation.role,
      expires_at: invitation.expiresAt,
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/invitations/:token/accept', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const token = params.token as string;
    const invitation = orgsState.invitations.find((inv) => inv.token === token);
    if (!invitation) return problem(404, 'Invitation not found');

    const existing = orgsState.memberships.find(
      (m) => m.orgId === invitation.orgId && m.user.id === caller.id,
    );
    if (existing) {
      const response: AcceptInvitationResponse = { org_id: invitation.orgId, role: existing.role };
      return HttpResponse.json(response);
    }

    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      return problem(410, 'This invitation has expired or has already been used');
    }
    if (invitation.acceptedBy && invitation.acceptedBy !== caller.id) {
      return problem(410, 'This invitation has expired or has already been used');
    }

    orgsState.memberships.push({ orgId: invitation.orgId, user: caller, role: invitation.role });
    invitation.acceptedBy = caller.id;
    const response: AcceptInvitationResponse = { org_id: invitation.orgId, role: invitation.role };
    return HttpResponse.json(response);
  }),

  // --- Projects (contracts §12, §13) ---

  http.get('/api/v1/projects', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    const response: ListProjectsResponse = { projects: orgsState.projects.map(toProject) };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/:projectId/events/summary', ({ request, params }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    const response: EventSummaryResponse = {
      project_id: params.projectId as string,
      ...EVENT_SUMMARY_FIXTURE,
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/orgs/:orgId/projects', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can create projects');
    const body = (await request.json()) as { name?: string; timezone?: string };
    if (!body.name?.trim()) {
      return problem(400, 'Validation failed', { errors: { name: ['required'] } });
    }
    const record: ProjectRecord = {
      id: nextId('project'),
      orgId,
      name: body.name.trim(),
      timezone: body.timezone?.trim() || 'UTC',
    };
    orgsState.projects.push(record);
    const token: TokenRecord = {
      id: nextId('token'),
      projectId: record.id,
      token: generateToken(),
      label: 'Default',
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    orgsState.tokens.push(token);
    const response: CreatedProject = {
      id: record.id,
      org_id: orgId,
      name: record.name,
      timezone: record.timezone,
      ingest_token: token.token,
    };
    return HttpResponse.json(response, { status: 201 });
  }),

  http.patch('/api/v1/projects/:projectId', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can update the project');
    const body = (await request.json()) as { name?: string; timezone?: string };
    if (body.name?.trim()) record.name = body.name.trim();
    if (body.timezone?.trim()) record.timezone = body.timezone.trim();
    const response: UpdateProjectResponse = {
      id: record.id,
      name: record.name,
      timezone: record.timezone,
    };
    return HttpResponse.json(response);
  }),

  http.delete('/api/v1/projects/:projectId', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can delete the project');
    orgsState.projects = orgsState.projects.filter((p) => p.id !== projectId);
    orgsState.tokens = orgsState.tokens.filter((t) => t.projectId !== projectId);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Tokens (contracts §13) ---

  http.get('/api/v1/projects/:projectId/tokens', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can view tokens');
    const response: ListTokensResponse = {
      tokens: orgsState.tokens
        .filter((t) => t.projectId === projectId && !t.revoked)
        .map((t) => ({ id: t.id, token: t.token, label: t.label, created_at: t.createdAt })),
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/projects/:projectId/tokens', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can create tokens');
    const body = (await request.json()) as { label?: string };
    const token: TokenRecord = {
      id: nextId('token'),
      projectId,
      token: generateToken(),
      label: body.label?.trim() || 'Untitled',
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    orgsState.tokens.push(token);
    const response: CreatedToken = { id: token.id, token: token.token, label: token.label };
    return HttpResponse.json(response, { status: 201 });
  }),

  http.delete('/api/v1/projects/:projectId/tokens/:tokenId', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (callerRole !== 'admin') return problem(403, 'Only admins can revoke tokens');
    const tokenId = params.tokenId as string;
    const token = orgsState.tokens.find((t) => t.id === tokenId && t.projectId === projectId);
    if (!token) return problem(404, 'Token not found');
    token.revoked = true;
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Core analytics (contracts §14) ---

  http.get('/api/v1/projects/:projectId/meta/events', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(META_EVENTS_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/meta/properties', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(META_PROPERTIES_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/meta/property-values', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const property = new URL(request.url).searchParams.get('property');
    if (!property) return problem(400, 'A property is required');
    // Designated free-form keys have no useful suggestions → empty list drives the free-text hint.
    if (FREE_FORM_PROPERTY_KEYS.has(property)) return HttpResponse.json({ values: [] });
    const overrides = PROPERTY_VALUES_BY_KEY[property];
    if (overrides) return HttpResponse.json({ values: overrides });
    return HttpResponse.json(META_PROPERTY_VALUES_FIXTURE);
  }),

  http.post('/api/v1/projects/:projectId/query/insights', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as InsightsQueryDefinition;
    if (!body.events || body.events.length === 0 || body.events.length > 5) {
      return problem(400, 'Invalid query definition: 1-5 events required');
    }
    const validIntervals = new Set(['hour', 'day', 'week', 'month']);
    if (!validIntervals.has(body.interval)) {
      return problem(400, 'Invalid query definition: unknown interval');
    }

    // Deterministic 3-bucket series so tests can assert on exact values. When a breakdown is
    // requested, each event fans out into two breakdown-value series (never a rainbow of
    // unbounded values in this fixture).
    const buckets = ['2026-06-29', '2026-06-30', '2026-07-01'];
    const breakdownValues: (string | null)[] = body.breakdown ? ['ios', 'android'] : [null];
    const series: InsightsSeries[] = [];
    body.events.forEach((eventQuery, eventIndex) => {
      breakdownValues.forEach((breakdownValue, breakdownIndex) => {
        series.push({
          name: eventQuery.name,
          breakdown_value: breakdownValue,
          data: buckets.map((t, bucketIndex) => ({
            t,
            value: (eventIndex + 1) * 10 + breakdownIndex * 5 + bucketIndex,
          })),
        });
      });
    });
    return HttpResponse.json({ series });
  }),

  http.get('/api/v1/projects/:projectId/metrics/engagement', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(ENGAGEMENT_FIXTURE);
  }),

  // --- Advanced analysis (contracts §15) ---

  http.post('/api/v1/projects/:projectId/query/funnels', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as FunnelQueryDefinition;
    if (!body.steps || body.steps.length < 2 || body.steps.length > 8) {
      return problem(400, 'Invalid funnel: 2-8 steps required');
    }
    // Deterministic monotonic decay (halving per step) keyed off the requested step events so the
    // rendered funnel matches the builder; exact-value tests override this handler.
    const top = 1000;
    const steps = body.steps.map((step, i) => {
      const count = Math.round(top * 0.5 ** i);
      const prev = i === 0 ? top : Math.round(top * 0.5 ** (i - 1));
      return {
        event: step.event,
        count,
        conversion_from_prev: i === 0 ? 1 : count / prev,
        conversion_from_top: count / top,
      };
    });
    const response: FunnelResponse = {
      steps,
      overall_conversion: (steps.at(-1)?.count ?? 0) / top,
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/projects/:projectId/query/retention', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as RetentionQueryDefinition;
    if (!body.born_event?.name) return problem(400, 'Invalid retention: born_event required');
    if (body.periods < 1 || body.periods > 30) {
      return problem(400, 'Invalid retention: periods out of range');
    }
    return HttpResponse.json(RETENTION_FIXTURE);
  }),

  http.post('/api/v1/projects/:projectId/query/flows', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as FlowsQueryDefinition;
    if (!body.anchor?.event) return problem(400, 'Invalid flow: anchor event required');
    if (body.steps < 1 || body.steps > 5) return problem(400, 'Invalid flow: steps out of range');
    return HttpResponse.json(FLOWS_FIXTURE);
  }),

  // --- Screens, user-path map & click heatmap (contracts §18/§19) ---

  http.get('/api/v1/projects/:projectId/screens', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(SCREENS_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/screens/:screenName/image', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return new HttpResponse(SCREEN_IMAGE_BYTES, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
    });
  }),

  // §18 Retake/delete (analyst+): removes a screen's stored image(s) + metadata → 204.
  http.delete('/api/v1/projects/:projectId/screens/:screenName', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/projects/:projectId/query/screen-paths', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as ScreenPathsQuery;
    if (body.steps < 1 || body.steps > 5) return problem(400, 'Invalid screen-paths: steps out of range');
    if (body.max_nodes_per_step < 1 || body.max_nodes_per_step > 20)
      return problem(400, 'Invalid screen-paths: max_nodes_per_step out of range');
    return HttpResponse.json(SCREEN_PATHS_FIXTURE);
  }),

  http.post('/api/v1/projects/:projectId/query/click-heatmap', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as ClickHeatmapQuery;
    if (!body.screen_name) return problem(400, 'Invalid heatmap: screen_name required');
    const { cols, rows } = body.grid;
    if (cols < 1 || cols > 100 || rows < 1 || rows > 100)
      return problem(400, 'Invalid heatmap: grid out of range');
    return HttpResponse.json({ ...CLICK_HEATMAP_FIXTURE, screen_name: body.screen_name });
  }),

  http.get('/api/v1/projects/:projectId/events/live', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '50');
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50, 100);
    const before = url.searchParams.get('before');
    const pool = before
      ? LIVE_EVENTS_FIXTURE.filter((e) => e.timestamp < before)
      : LIVE_EVENTS_FIXTURE;
    const page = pool.slice(0, limit);
    const next_before = pool.length > limit ? (page.at(-1)?.timestamp ?? null) : null;
    const response: LiveEventsResponse = { events: page, next_before };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/:projectId/users', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const url = new URL(request.url);
    const search = url.searchParams.get('search') ?? '';
    const limitParam = Number(url.searchParams.get('limit') ?? '50');
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50, 100);
    const cursor = url.searchParams.get('cursor');
    // Mirrors the backend (P4-T1): a case-insensitive substring of `search` against the canonical
    // id or the profile's name/email — so multiple people can share a match (disambiguation table).
    const needle = search.toLowerCase();
    let pool = USERS_FIXTURE.filter(
      (u) =>
        u.distinct_id.toLowerCase().includes(needle) ||
        (u.name?.toLowerCase().includes(needle) ?? false) ||
        (u.email?.toLowerCase().includes(needle) ?? false),
    );
    if (cursor) {
      const cursorIndex = pool.findIndex((u) => u.distinct_id === cursor);
      pool = cursorIndex >= 0 ? pool.slice(cursorIndex + 1) : pool;
    }
    const page = pool.slice(0, limit);
    const next_cursor = pool.length > limit ? (page.at(-1)?.distinct_id ?? null) : null;
    const response: ListUsersResponse = { users: page, next_cursor };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/:projectId/users/:distinctId', ({ request, params }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const distinctId = params.distinctId as string;
    const user = USERS_FIXTURE.find((u) => u.distinct_id === distinctId);
    if (!user) return problem(404, 'User not found');
    const response: UserProfileResponse = {
      distinct_id: distinctId,
      last_seen: user.last_seen,
      event_count: user.event_count,
      ...USER_PROFILE_FIXTURE,
    };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/:projectId/sessions/summary', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(SESSIONS_SUMMARY_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/metrics/revenue', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(REVENUE_SUMMARY_FIXTURE);
  }),

  // --- Distribution histograms (feat-09 §3.1) ---

  http.post('/api/v1/projects/:projectId/query/histogram', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as HistogramQuery;
    if (!body.event?.trim() || !body.property?.trim()) {
      return problem(400, 'Invalid histogram query: event and property are required');
    }
    const bins = body.bins ?? 20;
    if (bins < 2 || bins > 50) {
      return problem(400, 'Invalid histogram query: bins out of range');
    }
    return HttpResponse.json(HISTOGRAM_FIXTURE);
  }),

  // --- Templates catalog (contracts §19) — auth-only, shared across projects ---

  http.get('/api/v1/templates', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    return HttpResponse.json({ templates: TEMPLATES_FIXTURE });
  }),

  // Live cohort preview (§16) — runs an in-progress definition WITHOUT persisting. The count is
  // derived from the definition (10 per condition + the primary event's length) so a test can assert
  // the live preview reacts to the chosen event. Static path, so it doesn't collide with POST /cohorts.
  http.post('/api/v1/projects/:projectId/cohorts/preview', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as CohortDefinition;
    const first = body.conditions?.[0];
    const eventLen = first && 'event' in first ? first.event.length : 0;
    const count = (body.conditions?.length ?? 0) * 10 + eventLen;
    return HttpResponse.json({
      count,
      sample: ['user-001', 'user-002'],
    } satisfies CohortPreviewResponse);
  }),

  // --- Cohorts, saved reports & custom dashboards (contracts §16) + templates apply (§19) ---
  ...phase5Handlers,
];
