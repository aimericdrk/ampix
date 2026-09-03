import { http, HttpResponse } from 'msw';
import { phase5Handlers, TEMPLATES_FIXTURE } from './phase5-handlers';
import type {
  Activate2faResponse,
  AcceptInvitationResponse,
  AddProjectMemberRequest,
  AskDataResponse,
  AttributionResponse,
  DeletedEventResult,
  ListUserPropertiesResponse,
  ListUserPropertyValuesResponse,
  EraseUserResult,
  ExperimentResponse,
  HiddenUserListItem,
  ListHiddenUsersResponse,
  AuthResponse,
  AuthUser,
  CreatedProject,
  CreatedToken,
  EventSource,
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
  ListProjectAccessResponse,
  ListProjectMembersResponse,
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
  ProjectRole,
  RcIntegrationStatus,
  RcJournalEntry,
  RcJournalResponse,
  RcReplayResponse,
  RcResyncResponse,
  RenameOrgResponse,
  SessionsSummaryResponse,
  Setup2faResponse,
  JourneyAnalysisResponse,
  JourneyResponse,
  SubscriptionAttributionResponse,
  SubscriptionsSummaryResponse,
  UpdatedProjectMember,
  UpdateProjectResponse,
  UserListItem,
  TapElementsResponse,
  UserEventsResponse,
  UserProfileResponse,
  UserSubscription,
  UserSubscriptionResponse,
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

/**
 * A third TEST_ORG member who is NOT (yet) on TEST_PROJECT — no login credentials needed, it only
 * ever appears as an org-member fixture, used to exercise the project add-member picker
 * (per-project-roles).
 */
export const THIRD_ORG_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000003',
  email: 'grace@example.com',
  name: 'Grace Hopper',
};

/** Fixture project (contracts §12) — org_name + ingest_token included, requester owns it.
 *  RC-on is the fixture default; gating-off tests override the projects handler with
 *  {@link projectsHandlerWithoutRc}. */
export const TEST_PROJECT: Project = {
  id: '0197f6a0-0000-7000-8000-0000000000aa',
  org_id: '0197f6a0-0000-7000-8000-0000000000bb',
  org_name: "Ada's Workspace",
  name: 'Demo App',
  timezone: 'UTC',
  ingest_token: 'mam_0123456789abcdef0123456789abcdef',
  role: 'owner',
  integrations: { revenuecat: true },
};

/** Deterministic sample for GET /projects/:projectId/events/summary (contracts §12). */
export const EVENT_SUMMARY_FIXTURE: Omit<EventSummaryResponse, 'project_id'> = {
  total: 52,
  by_event: [
    { event: 'checkout_completed', count: 32, client_count: 32, server_count: 0 },
    { event: 'product_viewed', count: 20, client_count: 20, server_count: 0 },
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
    // Every 5th event is backend-emitted so tests exercise the server badge + source filter.
    source: n % 5 === 0 ? 'server' : 'client',
  };
});

/**
 * §17 soft remove — mutable across a test so hiding a user actually removes them from the list.
 * Reset between tests by `resetUsersAdminState()`, called from the shared setup.
 */
export const hiddenUsersState: HiddenUserListItem[] = [];

/** The ids erased in this test, so the users list stops serving them like the real backend. */
export const erasedUsersState = new Set<string>();

/** The `insert_id`s deleted one-by-one out of a user's timeline, so the events endpoint stops
 *  serving them exactly as the real one does once the row leaves ClickHouse. */
export const deletedEventIdsState = new Set<string>();

export function resetUsersAdminState(): void {
  hiddenUsersState.length = 0;
  erasedUsersState.clear();
  deletedEventIdsState.clear();
}

/** `GET /metrics/attribution` — one clearly-winning source, one unattributed bucket. */
export const ATTRIBUTION_FIXTURE: AttributionResponse = {
  total_installs: 1000,
  total_signups: 250,
  signup_rate: 0.25,
  by_source: [
    { value: 'google-play', installs: 600, signups: 180, signup_rate: 0.3 },
    { value: 'app-store', installs: 300, signups: 60, signup_rate: 0.2 },
    // The SDK captured no campaign at all for these — rendered as "Direct / unknown".
    { value: null, installs: 100, signups: 10, signup_rate: 0.1 },
  ],
  by_campaign: [{ value: 'launch', installs: 600, signups: 180, signup_rate: 0.3 }],
  by_medium: [{ value: 'organic', installs: 900, signups: 240, signup_rate: 0.2667 }],
  by_referrer: [
    { value: 'utm_source=google-play', installs: 600, signups: 180, signup_rate: 0.3 },
  ],
  accounts: [
    {
      distinct_id: 'user-001',
      first_seen: '2026-06-02T09:00:00.000Z',
      signed_up_at: '2026-06-03T11:30:00.000Z',
      name: 'Alex Chen',
      email: 'user001@example.com',
      first_utm_source: 'google-play',
      first_utm_campaign: 'launch',
      utm_source: 'google-play',
      utm_medium: 'organic',
      utm_campaign: 'launch',
      install_referrer: 'utm_source=google-play',
    },
    {
      // An install that never became an account — the population the page exists to separate out.
      distinct_id: 'user-002',
      first_seen: '2026-06-04T09:00:00.000Z',
      signed_up_at: null,
      name: null,
      email: null,
      first_utm_source: null,
      first_utm_campaign: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      install_referrer: null,
    },
  ],
};

/** `POST /query/experiment` — a control and a significantly better treatment. */
export const EXPERIMENT_FIXTURE: ExperimentResponse = {
  control_variant: 'control',
  total_exposed: 4000,
  total_converted: 500,
  has_enough_data: true,
  variants: [
    {
      variant: 'control',
      exposed: 2000,
      converted: 200,
      conversion_rate: 0.1,
      is_control: true,
      underpowered: false,
      comparison: null,
    },
    {
      variant: 'treatment',
      exposed: 2000,
      converted: 300,
      conversion_rate: 0.15,
      is_control: false,
      underpowered: false,
      comparison: {
        relative_uplift: 0.5,
        absolute_uplift: 0.05,
        p_value: 0.0000012,
        z_score: 4.79,
        confidence_interval: { low: 0.0295, high: 0.0705 },
        significant: true,
      },
    },
  ],
};

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
    first_seen: '2026-01-05T10:00:00.000Z',
    last_seen: '2026-07-01T10:00:00.000Z',
    event_count: 42,
    name: 'Alex Chen',
    email: 'alex.chen@example.com',
    phone: '+33 6 12 34 56 78',
  },
  {
    distinct_id: 'user-002',
    first_seen: '2026-02-10T09:30:00.000Z',
    last_seen: '2026-06-30T09:30:00.000Z',
    event_count: 17,
    name: 'Alex Wong',
    email: 'alex.wong@example.com',
    phone: null,
  },
  {
    distinct_id: 'user-003',
    first_seen: '2026-03-03T08:15:00.000Z',
    last_seen: '2026-06-29T08:15:00.000Z',
    event_count: 5,
    name: 'Priya Singh',
    email: 'priya@example.com',
    phone: null,
  },
  {
    distinct_id: 'user-004',
    first_seen: '2026-04-01T07:00:00.000Z',
    last_seen: '2026-06-28T07:00:00.000Z',
    event_count: 63,
    name: 'Jordan Lee',
    email: null,
    phone: '+1 415 555 0142',
  },
  {
    distinct_id: 'user-005',
    first_seen: '2026-05-05T06:45:00.000Z',
    last_seen: '2026-06-27T06:45:00.000Z',
    event_count: 9,
    name: null,
    email: null,
    phone: null,
  },
  ...Array.from({ length: 17 }, (_, i) => {
    const n = i + 6;
    return {
      distinct_id: `user-${String(n).padStart(3, '0')}`,
      first_seen: `2026-05-${String(26 - i).padStart(2, '0')}T06:00:00.000Z`,
      last_seen: `2026-06-${String(26 - i).padStart(2, '0')}T06:00:00.000Z`,
      event_count: n,
      name: `User ${n}`,
      email: `user${n}@example.com`,
      phone: null,
    };
  }),
];

/** Shared device/app context for the profile fixture's recent events. */
const DEVICE_CONTEXT_FIXTURE = {
  os: 'ios',
  os_version: '17.4',
  app_version: '2.0.0',
  app_build: '210',
  device_model: 'iPhone15,3',
  device_manufacturer: 'Apple',
  locale: 'fr-FR',
  timezone: 'Europe/Paris',
  network: 'wifi',
  sdk_version: '0.1.2',
  ip: '203.0.113.7',
};

export const USER_PROFILE_FIXTURE: Omit<
  UserProfileResponse,
  'distinct_id' | 'last_seen' | 'event_count'
> = {
  // §17 soft remove: the fixture user is visible, which is what every existing test assumes.
  hidden: false,
  profile: {
    plan: 'pro',
    name: 'Alex Chen',
    email: 'user001@example.com',
    phone: '+33 6 12 34 56 78',
    age: 36,
    gender: 'female',
    city: 'Paris',
    country: 'FR',
  },
  first_seen: '2026-05-01T08:00:00.000Z',
  // Newest-first. The $screen_view rows drive the screen-path chain: chronologically
  // home → catalog → catalog → cart, collapsing to home → catalog → cart. Non-screen events carry
  // a null screen_name. evt-108/evt-107 are the RevenueCat timeline rows (Task 20's tests) and are
  // `source: 'server'` — a webhook writes them, not the device — which is what keeps them out of
  // the timeline's session arithmetic.
  recent_events: [
    {
      insert_id: 'evt-108',
      event: '$rc_renewal',
      timestamp: '2026-07-01T10:05:00.000Z',
      session_id: 'sess-2',
      source: 'server',
      screen_name: null,
      properties: { product_id: 'pro_monthly', price: 9.99, currency: 'USD' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-106',
      event: 'checkout_completed',
      timestamp: '2026-07-01T10:00:00.000Z',
      session_id: 'sess-2',
      source: 'client',
      screen_name: null,
      properties: { country: 'FR', $price: 42.5, currency: 'EUR', order_id: 'ord-9' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-107',
      event: '$rc_initial_purchase',
      timestamp: '2026-07-01T09:59:00.000Z',
      session_id: 'sess-2',
      source: 'server',
      screen_name: null,
      properties: { product_id: 'pro_monthly', price: 9.99, currency: 'USD' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-105',
      event: '$screen_view',
      timestamp: '2026-07-01T09:58:00.000Z',
      session_id: 'sess-1',
      source: 'client',
      screen_name: 'cart',
      properties: { country: 'FR', $screen_name: 'cart' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-104',
      event: '$screen_view',
      timestamp: '2026-07-01T09:56:00.000Z',
      session_id: 'sess-1',
      source: 'client',
      screen_name: 'catalog',
      properties: { country: 'FR', $screen_name: 'catalog' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-103',
      event: '$screen_view',
      timestamp: '2026-07-01T09:54:00.000Z',
      session_id: 'sess-1',
      source: 'client',
      screen_name: 'catalog',
      properties: { country: 'FR', $screen_name: 'catalog' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-102',
      event: '$screen_view',
      timestamp: '2026-07-01T09:52:00.000Z',
      session_id: 'sess-1',
      source: 'client',
      screen_name: 'home',
      properties: { country: 'FR', $screen_name: 'home' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
    {
      insert_id: 'evt-101',
      event: 'app_opened',
      timestamp: '2026-07-01T09:50:00.000Z',
      session_id: 'sess-1',
      source: 'client',
      screen_name: null,
      properties: { country: 'FR' },
      context: DEVICE_CONTEXT_FIXTURE,
    },
  ],
  // §17 identity set — canonical id + an aliased anon_id — for the identity-correct per-user heatmap.
  distinct_ids: ['user-001', 'anon-001'],
};

/** Deterministic ranked elements for `POST /query/tap-elements`. One row is deliberately
 *  unlabelled — a tap that hit no identifiable widget, which the UI must still show. */
export const TAP_ELEMENTS_FIXTURE: TapElementsResponse = {
  screen_name: 'home',
  total: 96,
  truncated: false,
  elements: [
    { widget_type: 'ElevatedButton', widget_label: 'Continue', count: 52, users: 31 },
    { widget_type: 'IconButton', widget_label: 'Close', count: 28, users: 20 },
    { widget_type: '', widget_label: '', count: 16, users: 12 },
  ],
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

/**
 * Deterministic "Ask your data" (feat-17) result — a real event/property from META_EVENTS_FIXTURE /
 * META_PROPERTIES_FIXTURE, so a hydrated builder resolves to real, selectable options.
 */
export const ASK_DATA_FIXTURE: InsightsQueryDefinition = {
  events: [{ name: 'checkout_completed', aggregation: 'unique_users' }],
  date_range: { from: '2026-06-01', to: '2026-06-30' },
  interval: 'day',
  filters: [],
  breakdown: { property: 'os' },
};

// --- Advanced analysis fixtures (contracts §15) ---

/** Deterministic funnel used by the default handler when a test does not override it. */
export const FUNNEL_FIXTURE: FunnelResponse = {
  steps: [
    { event: 'app_open', count: 1000, conversion_from_prev: 1, conversion_from_top: 1 },
    { event: 'signup_started', count: 620, conversion_from_prev: 0.62, conversion_from_top: 0.62 },
    {
      event: 'checkout_completed',
      count: 145,
      conversion_from_prev: 0.234,
      conversion_from_top: 0.145,
    },
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

// --- RevenueCat integration fixtures (spec §4.7) ---

/** Deterministic status for `GET .../integrations/revenuecat` — connected, sandbox off, a full
 *  journal counts breakdown across all four statuses. */
export const RC_STATUS_FIXTURE: RcIntegrationStatus = {
  connected: true,
  webhook_path: `/webhooks/revenuecat/${TEST_PROJECT.id}`,
  webhook_secret: 'rcwh_test_secret_abc123',
  api_key_masked: '…1234',
  rc_project_id: 'rcproj_demo',
  sandbox_mode: false,
  last_webhook_at: '2026-07-01T09:58:00.000Z',
  backfill_status: 'completed',
  counts: { processed: 214, failed: 3, unlinked: 5, skipped: 8 },
};

export const RC_JOURNAL_FIXTURE: RcJournalEntry[] = [
  {
    id: 'rcje-4',
    rc_event_id: 'evt_rc_004',
    event_type: 'INITIAL_PURCHASE',
    rc_app_user_id: 'rcuser-001',
    status: 'processed',
    error: null,
    received_at: '2026-07-01T09:58:00.000Z',
  },
  {
    id: 'rcje-3',
    rc_event_id: 'evt_rc_003',
    event_type: 'RENEWAL',
    rc_app_user_id: 'rcuser-002',
    status: 'processed',
    error: null,
    received_at: '2026-06-30T14:10:00.000Z',
  },
  {
    id: 'rcje-2',
    rc_event_id: 'evt_rc_002',
    event_type: 'CANCELLATION',
    rc_app_user_id: null,
    status: 'unlinked',
    error: 'No user matched rc_app_user_id',
    received_at: '2026-06-30T08:00:00.000Z',
  },
  {
    id: 'rcje-1',
    rc_event_id: 'evt_rc_001',
    event_type: 'BILLING_ISSUE',
    rc_app_user_id: 'rcuser-003',
    status: 'failed',
    error: 'Downstream write failed',
    received_at: '2026-06-29T12:00:00.000Z',
  },
];

/** Deterministic sample for `GET /metrics/subscriptions` — $49.95 MRR, 5 active, 2 in trial. */
/** `GET /metrics/mrr-movement` sample: two daily buckets with a mix of gains and losses. */
export const MRR_MOVEMENT_FIXTURE = {
  currency: 'USD',
  approximate: true as const,
  buckets: [
    {
      bucket: '2026-06-30T00:00:00.000Z',
      new_cents: 1998,
      reactivation_cents: 0,
      expansion_cents: 0,
      contraction_cents: 0,
      churn_cents: -999,
      net_cents: 999,
    },
    {
      bucket: '2026-07-01T00:00:00.000Z',
      new_cents: 999,
      reactivation_cents: 500,
      expansion_cents: 300,
      contraction_cents: -200,
      churn_cents: 0,
      net_cents: 1599,
    },
  ],
  totals: {
    new_cents: 2997,
    reactivation_cents: 500,
    expansion_cents: 300,
    contraction_cents: -200,
    churn_cents: -999,
    net_cents: 2598,
  },
};

export const SUBSCRIPTIONS_SUMMARY_FIXTURE: SubscriptionsSummaryResponse = {
  mrr_cents: 4995,
  active: 5,
  in_trial: 2,
  grace: 1,
  new_subscriptions: 3,
  churned: 1,
  trials_started: 4,
  trials_converted: 2,
  by_day: [
    { t: '2026-06-29', new_subscriptions: 1, churned: 0, revenue: 999 },
    { t: '2026-06-30', new_subscriptions: 1, churned: 1, revenue: 1998 },
    { t: '2026-07-01', new_subscriptions: 1, churned: 0, revenue: 999 },
  ],
  by_product: [
    { product_id: 'pro_monthly', active: 3, mrr_cents: 2997 },
    { product_id: 'pro_annual', active: 2, mrr_cents: 1998 },
  ],
  by_store: [
    { store: 'app_store', active: 3 },
    { store: 'play_store', active: 2 },
  ],
  churn_reasons: [
    { reason: 'voluntary', count: 1 },
    { reason: 'billing_error', count: 1 },
  ],
  recent_events: [
    {
      insert_id: 'rcevt-3',
      event: '$rc_initial_purchase',
      distinct_id: 'user-001',
      timestamp: '2026-07-01T09:58:00.000Z',
      product_id: 'pro_monthly',
      price: 9.99,
    },
    {
      insert_id: 'rcevt-2',
      event: '$rc_renewal',
      distinct_id: 'user-002',
      timestamp: '2026-06-30T14:10:00.000Z',
      product_id: 'pro_annual',
      price: 99.99,
    },
  ],
};

/** Deterministic sample for `GET /metrics/subscriptions/attribution`: 10 trials, 4 converted. */
export const SUBSCRIPTION_ATTRIBUTION_FIXTURE: SubscriptionAttributionResponse = {
  drivers: [
    { event: '$screen_view', users: 40 },
    { event: 'checkout_completed', users: 12 },
  ],
  screens: [
    { screen_name: 'Paywall', users: 30 },
    { screen_name: 'Onboarding', users: 18 },
  ],
  time_to_convert: [
    { bucket: '<1d', users: 4 },
    { bucket: '1-3d', users: 3 },
    { bucket: '3-7d', users: 2 },
    { bucket: '7-14d', users: 1 },
  ],
  trial_funnel: { trials: 10, converted: 4 },
};

/**
 * Deterministic sample for `GET /metrics/subscriptions/journey`. Shaped so the assertions can tell
 * the blocks apart: a clear paywall lift, one event the control never does (undefined lift), and a
 * path whose deepest step is weakly shared.
 */
export const SUBSCRIPTION_JOURNEY_FIXTURE: JourneyResponse = {
  definition: {
    outcome: 'subscribe',
    outcome_events: ['$rc_initial_purchase'],
    outcome_criteria: 'Users whose first $rc_initial_purchase falls in the selected range.',
    control_criteria:
      'Users with activity in the selected range who have never bought ($rc_initial_purchase) at any time.',
    window_days: 7,
    path_steps: 8,
    excluded_event_prefix: '$rc',
    date_range: { from: '2026-07-01', to: '2026-07-30' },
    generated_at: '2026-07-31T00:00:00.000Z',
  },
  cohort: { users: 128 },
  control: { users: 512 },
  summary: [
    {
      metric: 'steps_before',
      unit: 'events',
      definition: 'Events recorded in the window before the anchor.',
      cohort: { p25: 12, median: 23, p75: 41 },
      control: { p25: 4, median: 9, p75: 15 },
      lift: 2.556,
    },
    {
      metric: 'days_to_outcome',
      unit: 'days',
      definition: "Days from the user's first event of any kind to their first $rc_initial_purchase.",
      cohort: { p25: 1.5, median: 4.2, p75: 11 },
      control: null,
      lift: null,
    },
  ],
  path: [
    {
      steps_before_outcome: 3,
      event: 'browse_catalog',
      screen_name: null,
      users: 30,
      share: 0.234,
      median_seconds_to_outcome: 132,
    },
    {
      steps_before_outcome: 2,
      event: '$screen_view',
      screen_name: '/pay',
      users: 98,
      share: 0.766,
      median_seconds_to_outcome: 73,
    },
    {
      steps_before_outcome: 1,
      event: 'paywall_viewed',
      screen_name: null,
      users: 95,
      share: 0.742,
      median_seconds_to_outcome: 21,
    },
  ],
  frequency: [
    {
      name: 'paywall_viewed',
      cohort_per_user: 2.4,
      control_per_user: 0.3,
      cohort_user_share: 0.9,
      control_user_share: 0.15,
      lift: 8,
    },
    {
      name: 'promo_code_entered',
      cohort_per_user: 0.6,
      control_per_user: 0,
      cohort_user_share: 0.4,
      control_user_share: 0,
      lift: null,
    },
  ],
  screens: [
    {
      name: '/pay',
      cohort_per_user: 1.8,
      control_per_user: 0.2,
      cohort_user_share: 0.88,
      control_user_share: 0.1,
      lift: 9,
    },
  ],
  products: [
    { product_id: 'pro_annual', period_type: 'NORMAL', users: 90, share: 0.703 },
    // A webhook that carried no product id still gets a row — hiding it would hide the gap.
    { product_id: null, period_type: null, users: 38, share: 0.297 },
  ],
};

/** Deterministic sample for `POST /metrics/subscriptions/journey/analyze`. */
export const SUBSCRIPTION_JOURNEY_ANALYSIS_FIXTURE: JourneyAnalysisResponse = {
  outcome: 'subscribe',
  headline: 'Subscribers reach the paywall eight times as often as everyone else.',
  findings: [
    {
      title: 'Paywall exposure is the separator',
      detail: 'Subscribers see the paywall far more often than the control group does.',
      evidence: ['paywall_viewed 2.4/user vs 0.3/user', 'lift 8x'],
    },
  ],
  caveats: ['Both cohorts are large enough to compare.'],
  report: SUBSCRIPTION_JOURNEY_FIXTURE,
};

/** Deterministic active subscription for `GET/POST .../users/:distinctId(/refresh)`. */
export const USER_SUBSCRIPTION_FIXTURE: UserSubscription = {
  status: 'active',
  product_id: 'pro_monthly',
  store: 'app_store',
  period_type: 'normal',
  total_spent_cents: 2997,
  mrr_cents: 999,
  currency: 'USD',
  first_purchase_at: '2026-05-01T08:00:00.000Z',
  expires_at: '2026-08-01T08:00:00.000Z',
  cancelled_at: null,
  rc_app_user_id: 'rcuser-001',
  rc_customer_url: 'https://app.revenuecat.com/customers/rcproj_demo/rcuser-001',
};

// --- Screens, user-path map & click heatmap fixtures (contracts §18/§19) ---

export const SCREENS_FIXTURE: ScreensResponse = {
  screens: [
    {
      screen_name: 'home',
      capture_count: 3,
      latest_captured_at: '2026-07-01T10:00:00Z',
      width: 390,
      height: 844,
      latest_image_hash: 'hash-home',
      latest_app_version: '1.0.0',
      // A stitched full-page capture: 2110 logical px of page, 844 per viewport.
      content_height: 2110,
      viewport_height: 844,
    },
    {
      screen_name: 'catalog',
      capture_count: 2,
      latest_captured_at: '2026-07-01T10:05:00Z',
      width: 390,
      height: 844,
      latest_image_hash: 'hash-catalog',
      latest_app_version: '1.0.0',
      content_height: null,
      viewport_height: null,
    },
    {
      screen_name: 'checkout',
      capture_count: 1,
      latest_captured_at: '2026-07-01T10:10:00Z',
      width: 390,
      height: 844,
      latest_image_hash: 'hash-checkout',
      latest_app_version: '1.0.0',
      content_height: null,
      viewport_height: null,
    },
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

/** Ada's Workspace — TEST_USER is owner, MFA_USER is analyst. Matches TEST_PROJECT.org_id/org_name. */
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

/** Per-project membership (per-project-roles) — independent of the owning org's memberships. */
interface ProjectMembershipRecord {
  projectId: string;
  user: AuthUser;
  role: ProjectRole;
}

interface ServerKeyRecord {
  id: string;
  projectId: string;
  key: string;
  label: string;
  canErase: boolean;
  createdAt: string;
  revoked: boolean;
}

interface TokenRecord {
  id: string;
  projectId: string;
  token: string;
  label: string;
  source: EventSource;
  canErase: boolean;
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
      { orgId: TEST_ORG_ID, user: TEST_USER, role: 'owner' as OrgRole },
      { orgId: TEST_ORG_ID, user: MFA_USER, role: 'analyst' as OrgRole },
      { orgId: TEST_ORG_ID, user: THIRD_ORG_USER, role: 'viewer' as OrgRole },
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
        source: 'client' as EventSource,
        canErase: false,
        createdAt: futureIso(-30),
        revoked: false,
      },
    ] as TokenRecord[],
    /** Empty by default: a project starts with no backend credential on the purchase service. */
    serverKeys: [] as ServerKeyRecord[],
    /**
     * TEST_USER owns TEST_PROJECT; MFA_USER is a project admin. THIRD_ORG_USER is deliberately left
     * off — an org member not yet on the project, for the add-member picker.
     */
    projectMemberships: [
      { projectId: TEST_PROJECT.id, user: TEST_USER, role: 'owner' as ProjectRole },
      { projectId: TEST_PROJECT.id, user: MFA_USER, role: 'admin' as ProjectRole },
    ] as ProjectMembershipRecord[],
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
  orgsState.serverKeys = fresh.serverKeys;
  orgsState.projectMemberships = fresh.projectMemberships;
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

/** Rank-based admin-or-above check (owner > admin > analyst > viewer) — mirrors RolesGuard('admin'). */
function isAdminOrOwner(role: OrgRole | undefined): boolean {
  return role === 'admin' || role === 'owner';
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

/**
 * A caller's role on a project: an explicit project membership wins; otherwise fall back to their
 * org role (every project-role literal except 'owner' overlaps with an org-role literal) — this
 * keeps ad-hoc projects seeded by other tests (with no project membership of their own) working.
 */
function projectRoleFor(projectId: string, orgId: string, userId: string): ProjectRole | undefined {
  const explicit = orgsState.projectMemberships.find(
    (m) => m.projectId === projectId && m.user.id === userId,
  );
  if (explicit) return explicit.role;
  return roleFor(orgId, userId);
}

function ownerCountFor(projectId: string): number {
  return orgsState.projectMemberships.filter((m) => m.projectId === projectId && m.role === 'owner')
    .length;
}

/**
 * A target user's EXPLICIT project role only (no org-role/owner-derived fallback) — mirrors
 * OrgProjectAccessService.list()/set(), which reason purely over ProjectMembership rows.
 */
function explicitProjectRole(projectId: string, userId: string): ProjectRole | null {
  return (
    orgsState.projectMemberships.find((m) => m.projectId === projectId && m.user.id === userId)
      ?.role ?? null
  );
}

function toProject(record: ProjectRecord, callerId: string): Project {
  const org = orgById(record.orgId);
  return {
    id: record.id,
    org_id: record.orgId,
    org_name: org?.name ?? '',
    name: record.name,
    timezone: record.timezone,
    ingest_token: ingestTokenFor(record.id),
    role: projectRoleFor(record.id, record.orgId, callerId) ?? 'viewer',
    // RC-on is the fixture default; gating-off tests override the handler via projectsHandlerWithoutRc().
    integrations: { revenuecat: true },
  };
}

/**
 * Gating-off override for `GET /api/v1/projects` — used by tests exercising the "RevenueCat not
 * connected" state (the nav item hidden, upsell shown, etc). Returns TEST_PROJECT unchanged except
 * for `integrations.revenuecat: false`; pass to `server.use(...)` for the duration of the test.
 */
export function projectsHandlerWithoutRc() {
  return http.get('/api/v1/projects', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    const caller = userForToken(token);
    if (!caller) return problem(401, 'Access token invalid or expired');
    const response: ListProjectsResponse = {
      projects: orgsState.projects.map((record) => ({
        ...toProject(record, caller.id),
        integrations: { revenuecat: false },
      })),
    };
    return HttpResponse.json(response);
  });
}

export const handlers = [
  // Public capability discovery — signups are open in the default test instance.
  http.get('/api/v1/auth/config', () => HttpResponse.json({ signup_enabled: true })),

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
      otpauth_url: `otpauth://totp/MyAmpix:${encodeURIComponent(user.email)}?secret=${MOCK_TOTP_SECRET}&issuer=MyAmpix`,
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
    orgsState.memberships.push({ orgId: org.id, user, role: 'owner' });
    const response: CreateOrgResponse = { id: org.id, name: org.name, role: 'owner' };
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
    if (!isAdminOrOwner(role)) return problem(403, 'Only admins can rename the organization');
    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) {
      return problem(400, 'Validation failed', { errors: { name: ['required'] } });
    }
    org.name = body.name.trim();
    const response: RenameOrgResponse = { id: org.id, name: org.name };
    return HttpResponse.json(response);
  }),

  // Owner-only, one step above PATCH's admin. Mirrors the server cascade: the org's projects (and
  // their tokens/memberships) and its memberships and invitations all go with it.
  http.delete('/api/v1/orgs/:orgId', ({ request, params }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const role = roleFor(orgId, user.id);
    if (!role) return problem(403, 'Not a member of this organization');
    if (role !== 'owner') return problem(403, 'Only the owner can delete the organization');

    const doomedProjects = orgsState.projects.filter((p) => p.orgId === orgId).map((p) => p.id);
    orgsState.projects = orgsState.projects.filter((p) => p.orgId !== orgId);
    orgsState.tokens = orgsState.tokens.filter((t) => !doomedProjects.includes(t.projectId));
    orgsState.projectMemberships = orgsState.projectMemberships.filter(
      (pm) => !doomedProjects.includes(pm.projectId),
    );
    orgsState.memberships = orgsState.memberships.filter((m) => m.orgId !== orgId);
    orgsState.invitations = orgsState.invitations.filter((i) => i.orgId !== orgId);
    orgsState.orgs = orgsState.orgs.filter((o) => o.id !== orgId);
    return new HttpResponse(null, { status: 204 });
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can change member roles');
    const membership = orgsState.memberships.find(
      (m) => m.orgId === orgId && m.user.id === targetUserId,
    );
    if (!membership) return problem(404, 'Member not found');
    const body = (await request.json()) as { role?: OrgRole };
    if (!body.role) return problem(400, 'Validation failed', { errors: { role: ['required'] } });

    if (body.role === 'owner') {
      // Ownership transfer: only the current owner may initiate it. Atomic: target -> owner,
      // caller -> admin. No-op (still owner) if the target already is the owner.
      if (callerRole !== 'owner') {
        return problem(403, 'Only the current owner can transfer ownership');
      }
      if (membership.role !== 'owner') {
        const currentOwner = orgsState.memberships.find(
          (m) => m.orgId === orgId && m.user.id === caller.id,
        );
        if (currentOwner) currentOwner.role = 'admin';
        membership.role = 'owner';
      }
      return HttpResponse.json({ id: membership.user.id, role: membership.role });
    }

    // The current owner's role can never be changed directly — transfer only.
    if (membership.role === 'owner') {
      return problem(409, "Cannot change the owner's role directly; transfer ownership instead");
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can remove members');
    const membership = orgsState.memberships.find(
      (m) => m.orgId === orgId && m.user.id === targetUserId,
    );
    if (!membership) return problem(404, 'Member not found');
    if (membership.role === 'owner') {
      return problem(409, 'Cannot remove the organization owner; transfer ownership first');
    }
    orgsState.memberships = orgsState.memberships.filter(
      (m) => !(m.orgId === orgId && m.user.id === targetUserId),
    );
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Org-scoped per-project access (org owner role) ---

  http.get('/api/v1/orgs/:orgId/members/:userId/project-access', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    const targetUserId = params.userId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can view project access');
    const response: ListProjectAccessResponse = {
      projects: orgsState.projects
        .filter((p) => p.orgId === orgId)
        .map((p) => ({
          projectId: p.id,
          name: p.name,
          role: explicitProjectRole(p.id, targetUserId),
        })),
    };
    return HttpResponse.json(response);
  }),

  http.put(
    '/api/v1/orgs/:orgId/members/:userId/project-access/:projectId',
    async ({ request, params }) => {
      const caller = userForToken(bearerToken(request));
      if (!caller) return problem(401, 'Access token invalid or expired');
      const orgId = params.orgId as string;
      const targetUserId = params.userId as string;
      const projectId = params.projectId as string;
      if (!orgById(orgId)) return problem(404, 'Organization not found');
      const callerRole = roleFor(orgId, caller.id);
      if (!callerRole) return problem(403, 'Not a member of this organization');
      if (!isAdminOrOwner(callerRole)) {
        return problem(403, 'Only admins can manage project access');
      }
      // Self-escalation guard: an admin can't manage their own project access; owner is exempt.
      if (callerRole !== 'owner' && targetUserId === caller.id) {
        return problem(403, 'Admins cannot change their own project access');
      }
      const record = projectRecordById(projectId);
      if (!record || record.orgId !== orgId) return problem(404, 'Project not found');

      const body = (await request.json()) as { role?: 'viewer' | 'analyst' | 'admin' | null };
      const newRole = body.role ?? null;

      const existing = orgsState.projectMemberships.find(
        (m) => m.projectId === projectId && m.user.id === targetUserId,
      );
      // Project-owner rows are immutable to admin callers (owner-safety, mirrors ProjectMembersService).
      if (existing?.role === 'owner' && callerRole !== 'owner') {
        return problem(403, 'Only owners can change the owner role');
      }
      // changeRole delegate's unconditional self-guard: nobody — not even an owner — may re-role
      // their OWN existing project membership row (project-members.service.ts `cannotChangeSelf`).
      // The ADD path (no existing row) still defers to the org self-escalation guard above.
      if (newRole !== null && existing && targetUserId === caller.id) {
        return problem(403, 'Cannot change your own project role');
      }
      // Last-owner invariant (mirrors ProjectMembersService.remove/changeRole `lastOwner`): only an
      // owner caller reaches here (admins were blocked above), but demoting/removing the sole
      // project owner is still a conflict.
      if (existing?.role === 'owner' && ownerCountFor(projectId) <= 1) {
        return problem(
          409,
          newRole === null ? 'Cannot remove the last owner' : 'Cannot demote the last owner',
        );
      }

      if (newRole === null) {
        if (existing) {
          orgsState.projectMemberships = orgsState.projectMemberships.filter(
            (m) => !(m.projectId === projectId && m.user.id === targetUserId),
          );
        }
        return HttpResponse.json({ projectId, role: null });
      }

      if (existing) {
        existing.role = newRole;
      } else {
        const orgMembership = orgsState.memberships.find(
          (m) => m.orgId === orgId && m.user.id === targetUserId,
        );
        if (!orgMembership) return problem(404, 'User is not a member of this organization');
        orgsState.projectMemberships.push({ projectId, user: orgMembership.user, role: newRole });
      }
      return HttpResponse.json({ projectId, role: newRole });
    },
  ),

  // --- Invitations (contracts §13) ---

  http.post('/api/v1/orgs/:orgId/invitations', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can create invitations');
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can list invitations');
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can revoke invitations');
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
    const caller = userForToken(token);
    if (!caller) return problem(401, 'Access token invalid or expired');
    const response: ListProjectsResponse = {
      projects: orgsState.projects.map((record) => toProject(record, caller.id)),
    };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/stats', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    const stats = orgsState.projects.map((record) => ({
      project_id: record.id,
      user_count: record.id === TEST_PROJECT.id ? 1234 : 0,
      top_country: record.id === TEST_PROJECT.id ? 'US' : null,
    }));
    return HttpResponse.json({ stats });
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

  // --- RevenueCat integration (spec §4.7) ---

  http.get('/api/v1/projects/:projectId/integrations/revenuecat', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(RC_STATUS_FIXTURE);
  }),

  http.put('/api/v1/projects/:projectId/integrations/revenuecat', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as {
      api_key?: string;
      rc_project_id?: string;
      sandbox_mode?: boolean;
    };
    const response: RcIntegrationStatus = {
      ...RC_STATUS_FIXTURE,
      connected: true,
      api_key_masked: body.api_key
        ? `…${body.api_key.slice(-4)}`
        : RC_STATUS_FIXTURE.api_key_masked,
      rc_project_id: body.rc_project_id ?? RC_STATUS_FIXTURE.rc_project_id,
      sandbox_mode: body.sandbox_mode ?? RC_STATUS_FIXTURE.sandbox_mode,
    };
    return HttpResponse.json(response);
  }),

  http.delete('/api/v1/projects/:projectId/integrations/revenuecat', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/projects/:projectId/integrations/revenuecat/events', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const status = new URL(request.url).searchParams.get('status');
    const events = status
      ? RC_JOURNAL_FIXTURE.filter((e) => e.status === status)
      : RC_JOURNAL_FIXTURE;
    const response: RcJournalResponse = { events };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/projects/:projectId/integrations/revenuecat/replay', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const response: RcReplayResponse = { replayed: 5, remaining: 0 };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/projects/:projectId/integrations/revenuecat/resync', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const response: RcResyncResponse = { status: 'started' };
    return HttpResponse.json(response, { status: 202 });
  }),

  http.get(
    '/api/v1/projects/:projectId/integrations/revenuecat/users/:distinctId',
    ({ request }) => {
      const token = bearerToken(request);
      if (!token || !ACCEPTED_TOKENS.has(token))
        return problem(401, 'Access token invalid or expired');
      const response: UserSubscriptionResponse = { subscription: USER_SUBSCRIPTION_FIXTURE };
      return HttpResponse.json(response);
    },
  ),

  http.post(
    '/api/v1/projects/:projectId/integrations/revenuecat/users/:distinctId/refresh',
    ({ request }) => {
      const token = bearerToken(request);
      if (!token || !ACCEPTED_TOKENS.has(token))
        return problem(401, 'Access token invalid or expired');
      const response: UserSubscriptionResponse = { subscription: USER_SUBSCRIPTION_FIXTURE };
      return HttpResponse.json(response);
    },
  ),

  http.get('/api/v1/projects/:projectId/metrics/subscriptions', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(SUBSCRIPTIONS_SUMMARY_FIXTURE);
  }),

  // `mobile_purchase`'s Overview summary endpoint (spec §1.1) — field-for-field identical shape
  // to the mirror's `/metrics/subscriptions` above, so the same fixture doubles for both.
  http.get('/api/v1/projects/:projectId/metrics/summary', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(SUBSCRIPTIONS_SUMMARY_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/metrics/mrr-movement', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(MRR_MOVEMENT_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/metrics/subscriptions/attribution', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(SUBSCRIPTION_ATTRIBUTION_FIXTURE);
  }),

  http.get('/api/v1/projects/:projectId/metrics/subscriptions/journey', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const outcome = new URL(request.url).searchParams.get('outcome') ?? 'subscribe';
    return HttpResponse.json({
      ...SUBSCRIPTION_JOURNEY_FIXTURE,
      definition: { ...SUBSCRIPTION_JOURNEY_FIXTURE.definition, outcome },
    });
  }),

  http.post('/api/v1/projects/:projectId/metrics/subscriptions/journey/analyze', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(SUBSCRIPTION_JOURNEY_ANALYSIS_FIXTURE);
  }),

  http.post('/api/v1/orgs/:orgId/projects', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const orgId = params.orgId as string;
    if (!orgById(orgId)) return problem(404, 'Organization not found');
    const callerRole = roleFor(orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can create projects');
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
      source: 'client',
      canErase: false,
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can update the project');
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can delete the project');
    orgsState.projects = orgsState.projects.filter((p) => p.id !== projectId);
    orgsState.tokens = orgsState.tokens.filter((t) => t.projectId !== projectId);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Per-project members (per-project-roles) ---

  http.get('/api/v1/projects/:projectId/members', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    if (!projectRoleFor(projectId, record.orgId, caller.id)) {
      return problem(403, 'Not a member of this project');
    }
    const response: ListProjectMembersResponse = {
      members: orgsState.projectMemberships
        .filter((m) => m.projectId === projectId)
        .map((m) => ({ user: m.user, role: m.role })),
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/projects/:projectId/members', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = projectRoleFor(projectId, record.orgId, caller.id);
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return problem(403, 'Only project owners and admins can add members');
    }
    const body = (await request.json()) as Partial<AddProjectMemberRequest>;
    if (!body.userId || !body.role) {
      return problem(400, 'Validation failed', {
        errors: { userId: body.userId ? [] : ['required'], role: body.role ? [] : ['required'] },
      });
    }
    if (body.role === 'owner' && callerRole !== 'owner') {
      return problem(403, 'Only owners can grant the owner role');
    }
    const orgMembership = orgsState.memberships.find(
      (m) => m.orgId === record.orgId && m.user.id === body.userId,
    );
    if (!orgMembership) return problem(404, 'User is not a member of this organization');
    const existing = orgsState.projectMemberships.find(
      (m) => m.projectId === projectId && m.user.id === body.userId,
    );
    if (existing) {
      existing.role = body.role;
    } else {
      orgsState.projectMemberships.push({ projectId, user: orgMembership.user, role: body.role });
    }
    const response: UpdatedProjectMember = { user_id: body.userId, role: body.role };
    return HttpResponse.json(response, { status: 201 });
  }),

  http.patch('/api/v1/projects/:projectId/members/:userId', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const targetUserId = params.userId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = projectRoleFor(projectId, record.orgId, caller.id);
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return problem(403, 'Only project owners and admins can change member roles');
    }
    const membership = orgsState.projectMemberships.find(
      (m) => m.projectId === projectId && m.user.id === targetUserId,
    );
    if (!membership) return problem(404, 'Member not found');
    const body = (await request.json()) as { role?: ProjectRole };
    if (!body.role) return problem(400, 'Validation failed', { errors: { role: ['required'] } });
    if ((membership.role === 'owner' || body.role === 'owner') && callerRole !== 'owner') {
      return problem(403, 'Only owners can change the owner role');
    }
    if (membership.role === 'owner' && body.role !== 'owner' && ownerCountFor(projectId) <= 1) {
      return problem(409, 'Cannot demote the last owner');
    }
    membership.role = body.role;
    const response: UpdatedProjectMember = { user_id: membership.user.id, role: membership.role };
    return HttpResponse.json(response);
  }),

  http.delete('/api/v1/projects/:projectId/members/:userId', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const targetUserId = params.userId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = projectRoleFor(projectId, record.orgId, caller.id);
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return problem(403, 'Only project owners and admins can remove members');
    }
    const membership = orgsState.projectMemberships.find(
      (m) => m.projectId === projectId && m.user.id === targetUserId,
    );
    if (!membership) return problem(404, 'Member not found');
    if (membership.role === 'owner' && callerRole !== 'owner') {
      return problem(403, 'Only owners can remove an owner');
    }
    if (membership.role === 'owner' && ownerCountFor(projectId) <= 1) {
      return problem(409, 'Cannot remove the last owner');
    }
    orgsState.projectMemberships = orgsState.projectMemberships.filter(
      (m) => !(m.projectId === projectId && m.user.id === targetUserId),
    );
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can view tokens');
    const response: ListTokensResponse = {
      tokens: orgsState.tokens
        .filter((t) => t.projectId === projectId && !t.revoked)
        .map((t) => ({
          id: t.id,
          token: t.token,
          label: t.label,
          source: t.source,
          can_erase: t.canErase,
          created_at: t.createdAt,
        })),
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can create tokens');
    const body = (await request.json()) as {
      label?: string;
      source?: EventSource;
      can_erase?: boolean;
    };
    if (body.source !== undefined && body.source !== 'client' && body.source !== 'server') {
      return problem(400, 'source must be client or server');
    }
    // Mirrors the API's refine: erasure rights are only ever grantable to a server token.
    if (body.can_erase === true && body.source !== 'server') {
      return problem(400, 'can_erase requires source "server"');
    }
    const token: TokenRecord = {
      id: nextId('token'),
      projectId,
      token: generateToken(),
      label: body.label?.trim() || 'Untitled',
      source: body.source ?? 'client',
      canErase: body.can_erase === true,
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    orgsState.tokens.push(token);
    const response: CreatedToken = {
      id: token.id,
      token: token.token,
      label: token.label,
      source: token.source,
      can_erase: token.canErase,
    };
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
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can revoke tokens');
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
    const validIntervals = new Set(['hour', 'day', 'week', 'month', 'range']);
    if (!validIntervals.has(body.interval)) {
      return problem(400, 'Invalid query definition: unknown interval');
    }

    // Deterministic 3-bucket series so tests can assert on exact values. When a breakdown is
    // requested, each event fans out into two breakdown-value series (never a rainbow of
    // unbounded values in this fixture) — except `country` (feat-18 §3.4), which fans out into
    // three raw SDK-style values (two resolvable, one not) so Home's Installations section has
    // something realistic to fold through `toIso3`/aggregate into an "Unknown" bucket.
    // `range` means ONE bucket for the whole span — the mock has to honour that, or a caller that
    // regressed to summing a daily series would still look correct here.
    const buckets =
      body.interval === 'range'
        ? [body.date_range.from]
        : ['2026-06-29', '2026-06-30', '2026-07-01'];
    const breakdownValues: (string | null)[] =
      body.breakdown?.property === 'country'
        ? ['US', 'FR', 'Wakanda']
        : body.breakdown
          ? ['ios', 'android']
          : [null];
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

  // --- Ask your data (feat-17 §3.2) ---

  http.post('/api/v1/projects/:projectId/query/ask', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { question?: string };
    if (!body.question || body.question.trim().length === 0) {
      return problem(422, 'Could not turn that into a query');
    }
    const response: AskDataResponse = { question: body.question, definition: ASK_DATA_FIXTURE };
    return HttpResponse.json(response);
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
    if (body.steps < 1 || body.steps > 5)
      return problem(400, 'Invalid screen-paths: steps out of range');
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

  http.post('/api/v1/projects/:projectId/query/tap-elements', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { screen_name?: string };
    if (!body.screen_name) return problem(400, 'Invalid query: screen_name required');
    return HttpResponse.json({ ...TAP_ELEMENTS_FIXTURE, screen_name: body.screen_name });
  }),

  http.get('/api/v1/projects/:projectId/events/live', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '50');
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50, 100);
    const before = url.searchParams.get('before');
    const source = url.searchParams.get('source');
    if (source !== null && source !== 'client' && source !== 'server')
      return problem(400, "source: must be 'client' or 'server'");
    let pool = before
      ? LIVE_EVENTS_FIXTURE.filter((e) => e.timestamp < before)
      : LIVE_EVENTS_FIXTURE;
    if (source) pool = pool.filter((e) => e.source === source);
    const page = pool.slice(0, limit);
    const next_before = pool.length > limit ? (page.at(-1)?.timestamp ?? null) : null;
    const response: LiveEventsResponse = { events: page, next_before };
    return HttpResponse.json(response);
  }),

  /**
   * §17 soft remove. In-memory and mutable so a test can hide a user and then assert they leave the
   * list — `resetHiddenUsers()` (called from the shared test setup) puts it back.
   *
   * Declared BEFORE `/users/:distinctId` for the same reason the real controller does: the param
   * route would otherwise answer `/users/hidden` with the profile of a user named "hidden".
   */
  http.get('/api/v1/projects/:projectId/users/hidden', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const response: ListHiddenUsersResponse = { users: [...hiddenUsersState] };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/projects/:projectId/users/:distinctId/hide', ({ request, params }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const distinctId = params.distinctId as string;
    if (!hiddenUsersState.some((entry) => entry.distinct_id === distinctId)) {
      hiddenUsersState.push({
        distinct_id: distinctId,
        hidden_at: '2026-08-01T10:00:00.000Z',
        hidden_by: 'Test Admin',
      });
    }
    return HttpResponse.json({ distinct_id: distinctId });
  }),

  http.delete('/api/v1/projects/:projectId/users/:distinctId/hide', ({ request, params }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const distinctId = params.distinctId as string;
    const index = hiddenUsersState.findIndex((entry) => entry.distinct_id === distinctId);
    if (index >= 0) hiddenUsersState.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * Deleting ONE event out of a user's history. Declared before `/users/:distinctId` alongside the
   * other user-admin routes; it answers with the row it removed, like the real endpoint.
   */
  http.delete('/api/v1/projects/:projectId/users/:distinctId/events/:insertId', ({ request, params }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const insertId = params.insertId as string;
    const event = USER_PROFILE_FIXTURE.recent_events.find((e) => e.insert_id === insertId);
    if (!event || deletedEventIdsState.has(insertId)) return problem(404, 'No such event for this user');
    deletedEventIdsState.add(insertId);
    const response: DeletedEventResult = {
      insert_id: insertId,
      event: event.event,
      timestamp: event.timestamp,
    };
    return HttpResponse.json(response);
  }),

  /** The irreversible erase. Reports the id set it removed, exactly as the real endpoint does. */
  http.delete('/api/v1/projects/:projectId/users/:distinctId', ({ request, params }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const distinctId = params.distinctId as string;
    erasedUsersState.add(distinctId);
    const response: EraseUserResult = {
      ids: [distinctId, `anon-${distinctId}`],
      subscriptionStates: 1,
      revenueCatWebhookEvents: 2,
    };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/:projectId/metrics/attribution', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    return HttpResponse.json(ATTRIBUTION_FIXTURE);
  }),

  http.post('/api/v1/projects/:projectId/query/experiment', async ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { variant_property?: string };
    // Mirrors the server's validation surface closely enough for the page's error path.
    if (!body.variant_property) return problem(400, 'variant_property is required');
    return HttpResponse.json(EXPERIMENT_FIXTURE);
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
    // Same rule as the server: a hidden (or erased) user is gone from the audience list.
    pool = pool.filter(
      (u) =>
        !hiddenUsersState.some((entry) => entry.distinct_id === u.distinct_id) &&
        !erasedUsersState.has(u.distinct_id),
    );
    // The audience filters. Mirrors the server's rule: identified = the profile carries an email or
    // a phone. `user-001` is the only fixture user with either, so it is that row against the rest.
    const identity = url.searchParams.get('identity');
    const contactable = (u: (typeof USERS_FIXTURE)[number]) =>
      u.distinct_id === 'user-001' &&
      Boolean(USER_PROFILE_FIXTURE.profile.email || USER_PROFILE_FIXTURE.profile.phone);
    if (identity === 'identified') pool = pool.filter(contactable);
    if (identity === 'anonymous') pool = pool.filter((u) => !contactable(u));
    const rawFilters = url.searchParams.get('filters');
    if (rawFilters) {
      const parsed = JSON.parse(rawFilters) as Array<{ property: string; op: string; value?: string }>;
      for (const filter of parsed) {
        const held = USER_PROFILE_FIXTURE.profile as Record<string, unknown>;
        const matches = (u: (typeof USERS_FIXTURE)[number]) =>
          u.distinct_id === 'user-001' && String(held[filter.property] ?? '') === String(filter.value ?? '');
        pool = filter.op === 'eq' ? pool.filter(matches) : pool;
      }
    }
    if (cursor) {
      const cursorIndex = pool.findIndex((u) => u.distinct_id === cursor);
      pool = cursorIndex >= 0 ? pool.slice(cursorIndex + 1) : pool;
    }
    const page = pool.slice(0, limit);
    const next_cursor = pool.length > limit ? (page.at(-1)?.distinct_id ?? null) : null;
    const response: ListUsersResponse = { users: page, next_cursor };
    return HttpResponse.json(response);
  }),

  /** Declared before `/users/:distinctId`, like the real controller's discovery routes. */
  http.get('/api/v1/projects/:projectId/users/properties', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const response: ListUserPropertiesResponse = {
      properties: Object.keys(USER_PROFILE_FIXTURE.profile).map((property) => ({
        property,
        users: 1,
      })),
    };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/projects/:projectId/users/property-values', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const property = new URL(request.url).searchParams.get('property') ?? '';
    if (property === '') return problem(400, 'property is required (1-255 characters)');
    const held = (USER_PROFILE_FIXTURE.profile as Record<string, unknown>)[property];
    const response: ListUserPropertyValuesResponse = {
      values: held === undefined || held === null ? [] : [String(held)],
    };
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
      hidden: hiddenUsersState.some((entry) => entry.distinct_id === distinctId),
    };
    return HttpResponse.json(response);
  }),

  /**
   * The profile timeline's pages. Serves the same rows as the profile in one page by default, so
   * every existing timeline assertion still sees the whole fixture; a test that needs to exercise
   * "load more" overrides this handler with its own paging.
   */
  http.get('/api/v1/projects/:projectId/users/:distinctId/events', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token))
      return problem(401, 'Access token invalid or expired');
    const url = new URL(request.url, 'http://localhost');
    // Mirrors the API's rule: the cursor's two halves travel together or not at all.
    if (url.searchParams.has('before') !== url.searchParams.has('before_id')) {
      return problem(400, 'before_id is required alongside before');
    }
    const response: UserEventsResponse = {
      events: USER_PROFILE_FIXTURE.recent_events.filter(
        (event) => !deletedEventIdsState.has(event.insert_id),
      ),
      next_before: null,
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

  // --- Purchase-service server keys ---
  //
  // Served from the same origin here because tests leave `purchaseApiBaseUrl` unset; in the running
  // app these live on the mobile_purchase service. Admin-only, mirroring the real controller.

  http.get('/api/v1/projects/:projectId/server-keys', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can view server keys');
    return HttpResponse.json(
      orgsState.serverKeys
        .filter((k) => k.projectId === projectId && !k.revoked)
        .map((k) => ({
          id: k.id,
          key: k.key,
          label: k.label,
          can_erase: k.canErase,
          created_at: k.createdAt,
        })),
    );
  }),

  http.post('/api/v1/projects/:projectId/server-keys', async ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can create server keys');
    const body = (await request.json()) as { label?: string; can_erase?: boolean };
    const key: ServerKeyRecord = {
      id: nextId('server-key'),
      projectId,
      key: `mp_srv_${nextId('srv').replace(/\D/g, '').padStart(32, '0')}`,
      label: body.label?.trim() || 'default',
      canErase: body.can_erase === true,
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    orgsState.serverKeys.push(key);
    return HttpResponse.json(
      {
        id: key.id,
        key: key.key,
        label: key.label,
        can_erase: key.canErase,
        created_at: key.createdAt,
      },
      { status: 201 },
    );
  }),

  http.delete('/api/v1/projects/:projectId/server-keys/:keyId', ({ request, params }) => {
    const caller = userForToken(bearerToken(request));
    if (!caller) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const record = projectRecordById(projectId);
    if (!record) return problem(404, 'Project not found');
    const callerRole = roleFor(record.orgId, caller.id);
    if (!callerRole) return problem(403, 'Not a member of this organization');
    if (!isAdminOrOwner(callerRole)) return problem(403, 'Only admins can revoke server keys');
    const key = orgsState.serverKeys.find(
      (k) => k.id === params.keyId && k.projectId === projectId && !k.revoked,
    );
    if (!key) return problem(404, 'Server key not found');
    key.revoked = true;
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Cohorts, saved reports & custom dashboards (contracts §16) + templates apply (§19) ---
  ...phase5Handlers,
];
