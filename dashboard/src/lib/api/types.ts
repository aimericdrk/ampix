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

// --- Core analytics (contracts §14) ---

/** `total` = count(DISTINCT insert_id); `unique_users` = uniqExact(distinct_id). */
export type InsightsAggregation = 'total' | 'unique_users';

export interface InsightsEventQuery {
  name: string;
  aggregation: InsightsAggregation;
}

/** Inclusive UTC dates, `YYYY-MM-DD`. */
export interface InsightsDateRange {
  from: string;
  to: string;
}

export type InsightsInterval = 'hour' | 'day' | 'week' | 'month';

export const INSIGHTS_INTERVALS: InsightsInterval[] = ['hour', 'day', 'week', 'month'];

export type InsightsFilterOp = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'is_set' | 'is_not_set';

export const INSIGHTS_FILTER_OPS: InsightsFilterOp[] = [
  'eq',
  'neq',
  'contains',
  'gt',
  'lt',
  'is_set',
  'is_not_set',
];

/** `value` is omitted/ignored for the value-less ops `is_set` / `is_not_set`. */
export interface InsightsFilter {
  property: string;
  op: InsightsFilterOp;
  value?: string;
}

export interface InsightsBreakdown {
  property: string;
}

/**
 * The builder state IS this shape (contracts §14) — also the saved-report shape in Phase 5.
 * 1..5 events, AND-joined filters, an optional single breakdown (top 20 values).
 */
export interface InsightsQueryDefinition {
  events: InsightsEventQuery[];
  date_range: InsightsDateRange;
  interval: InsightsInterval;
  filters: InsightsFilter[];
  breakdown?: InsightsBreakdown;
  /** Phase-5 (§16): optional cohort filter — AND-joins the cohort's `distinct_id IN (…)` predicate. */
  cohort_id?: string;
}

export interface InsightsSeriesPoint {
  t: string;
  value: number;
}

/** One series per (event × breakdown value); buckets zero-filled across the range. */
export interface InsightsSeries {
  name: string;
  breakdown_value: string | null;
  data: InsightsSeriesPoint[];
}

export interface InsightsResponse {
  series: InsightsSeries[];
}

/** GET /metrics/engagement response (mirrors backend `analytics.types.ts` §19). */
export type EngagementMetric = 'dau' | 'wau' | 'mau';

export interface EngagementActivePoint {
  t: string;
  /** `dau`|`wau`|`mau`, chosen by the query interval (day|week|month). */
  metric: EngagementMetric;
  value: number;
}

export interface EngagementStickinessPoint {
  t: string;
  /** Active-users-in-bucket ÷ distinct active users over the whole range (DAU/MAU-style ratio). */
  value: number;
}

export interface EngagementNewReturningPoint {
  t: string;
  /** Users whose first-ever event falls in this bucket. */
  new: number;
  /** Active users in this bucket first seen before it. */
  returning: number;
}

export interface EngagementResponse {
  active: EngagementActivePoint[];
  stickiness: EngagementStickinessPoint[];
  new_vs_returning: EngagementNewReturningPoint[];
}

export interface LiveEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  os: string;
  app_version: string;
}

/** `GET /events/live` — newest-first; `next_before` feeds the next page's `before` param. */
export interface LiveEventsResponse {
  events: LiveEvent[];
  next_before: string | null;
}

export interface UserListItem {
  distinct_id: string;
  last_seen: string;
  event_count: number;
  /** From the user's profile (whitelisted keys); null when not set — search also matches these. */
  name: string | null;
  email: string | null;
}

/** `GET /users` — `search` is a case-insensitive substring match across the canonical id, aliased
 *  anon_ids, and whitelisted profile props (name/email/username); `next_cursor` is the last `distinct_id`. */
export interface ListUsersResponse {
  users: UserListItem[];
  next_cursor: string | null;
}

export interface UserRecentEvent {
  insert_id: string;
  event: string;
  timestamp: string;
  /** The `$screen_name` of `$screen_view`/`$tap` events; null for events without one. */
  screen_name: string | null;
}

/** `GET /users/:distinctId` — `profile` is the raw `user_profiles` row (arbitrary keys). */
export interface UserProfileResponse {
  distinct_id: string;
  profile: Record<string, string | number | boolean | null>;
  first_seen: string;
  last_seen: string;
  event_count: number;
  recent_events: UserRecentEvent[];
  /**
   * §17 identity set — the canonical id plus every anon_id aliasing to it; feed to the click-heatmap
   * `distinct_ids` for identity-correct per-user results.
   */
  distinct_ids: string[];
}

export interface SessionsByDay {
  t: string;
  sessions: number;
  avg_duration_ms: number;
}

/** `GET /sessions/summary` — derived from `$session_end` events' `$duration_ms` property. */
export interface SessionsSummaryResponse {
  sessions: number;
  avg_duration_ms: number;
  by_day: SessionsByDay[];
}

export interface RevenueByDay {
  t: string;
  revenue: number;
  purchases: number;
}

export interface RevenueByProduct {
  product_id: string;
  revenue: number;
  purchases: number;
}

/** `GET /metrics/revenue` — derived from `$in_app_purchase` events' `$price`/`$product_id`. */
export interface RevenueSummaryResponse {
  total_revenue: number;
  purchases: number;
  paying_users: number;
  arppu: number;
  avg_purchase_value: number;
  by_day: RevenueByDay[];
  by_product: RevenueByProduct[];
}

/** `GET /meta/events` — distinct event names seen in the last 30 days, for the builder's autocomplete. */
export interface MetaEventsResponse {
  events: string[];
}

export type MetaPropertyType = 'string' | 'number' | 'column';

export interface MetaProperty {
  name: string;
  type: MetaPropertyType;
}

/** `GET /meta/properties` — known event columns + distinct top-level `properties` keys seen. */
export interface MetaPropertiesResponse {
  properties: MetaProperty[];
}

/** `GET /meta/property-values` — distinct values of one property (autosuggest), frequency-ranked. */
export interface MetaPropertyValuesResponse {
  values: string[];
}

// --- Advanced analysis (contracts §15) ---
// Request/response shapes mirror shared-contracts §15 byte-for-byte (the concurrent backend builds
// against the same section). Filters/date-range/breakdown reuse the §14 primitives above.

/** One funnel step: an event plus optional §14 filters (AND-joined). */
export interface FunnelStep {
  event: string;
  filters: InsightsFilter[];
}

/** `any` = steps may be interleaved; `strict_order` = steps strictly consecutive in time. */
export type FunnelOrder = 'any' | 'strict_order';

export const FUNNEL_ORDERS: FunnelOrder[] = ['any', 'strict_order'];

/** `POST /query/funnels` body — 2..8 ordered steps, a 1..365-day conversion window. */
export interface FunnelQueryDefinition {
  steps: FunnelStep[];
  date_range: InsightsDateRange;
  window_days: number;
  order: FunnelOrder;
  breakdown?: InsightsBreakdown;
  /** Phase-5 (§16): optional cohort filter (`cohort_id`). */
  cohort_id?: string;
}

/**
 * `conversion_from_prev` = count / previous step count (1.0 for step 0);
 * `conversion_from_top` = count / step-0 count. Both `0` when the denominator is `0`.
 */
export interface FunnelResultStep {
  event: string;
  count: number;
  conversion_from_prev: number;
  conversion_from_top: number;
}

/** One funnel per breakdown value (top 10, rest folded into `$other`); present only when breakdown set. */
export interface FunnelBreakdownResult {
  value: string;
  steps: FunnelResultStep[];
  overall_conversion: number;
}

export interface FunnelResponse {
  steps: FunnelResultStep[];
  overall_conversion: number;
  breakdowns?: FunnelBreakdownResult[];
}

/** Retention period granularity — a constant-map keyword, not free text. */
export type RetentionInterval = 'day' | 'week';

export const RETENTION_INTERVALS: RetentionInterval[] = ['day', 'week'];

/** A cohort-defining or returning event: a name plus optional §14 filters. */
export interface RetentionEvent {
  name: string;
  filters: InsightsFilter[];
}

/** `POST /query/retention` body — `return_event` defaults to `born_event` when omitted; `periods` is 1..30. */
export interface RetentionQueryDefinition {
  born_event: RetentionEvent;
  return_event?: RetentionEvent;
  date_range: InsightsDateRange;
  interval: RetentionInterval;
  periods: number;
  /** Phase-5 (§16): optional cohort filter (`cohort_id`). */
  cohort_id?: string;
}

export interface RetentionPeriodCell {
  period: number;
  count: number;
  rate: number;
}

/** Cohort row: born bucket + its size; period 0 is the cohort itself (`count == size`, `rate == 1.0`). */
export interface RetentionCohort {
  cohort: string;
  size: number;
  periods: RetentionPeriodCell[];
}

/** Size-weighted mean retention rate per period, across all cohorts. */
export interface RetentionAveragePoint {
  period: number;
  rate: number;
}

export interface RetentionResponse {
  cohorts: RetentionCohort[];
  averages: RetentionAveragePoint[];
}

/** `forward` = events after the anchor; `backward` = events before it. */
export type FlowsDirection = 'forward' | 'backward';

export const FLOWS_DIRECTIONS: FlowsDirection[] = ['forward', 'backward'];

/** `session` = split by session id; `user` = the whole user timeline. */
export type FlowsUnit = 'session' | 'user';

export const FLOWS_UNITS: FlowsUnit[] = ['session', 'user'];

export interface FlowsAnchor {
  event: string;
  filters: InsightsFilter[];
}

/** `POST /query/flows` body — `steps` is 1..5 hops, `max_nodes_per_step` is 1..20. */
export interface FlowsQueryDefinition {
  anchor: FlowsAnchor;
  direction: FlowsDirection;
  date_range: InsightsDateRange;
  steps: number;
  max_nodes_per_step: number;
  unit: FlowsUnit;
}

/** Sankey node — `id` is `"{step}:{event}"`, unique across steps even when an event recurs. */
export interface FlowNode {
  id: string;
  step: number;
  event: string;
  value: number;
}

/** Sankey link — `source`/`target` reference `FlowNode.id`. */
export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

export interface FlowsResponse {
  nodes: FlowNode[];
  links: FlowLink[];
}

// --- Screens, user-path map & click heatmap (contracts §18/§19, v2) ---

/** §18 `GET /screens` row — one per captured screen (bounded, deduped per app version). */
export interface ScreenSummary {
  screen_name: string;
  capture_count: number;
  latest_captured_at: string;
  width: number;
  height: number;
  /** Content hash of the newest capture — content-addresses the image URL so a retake busts the cache. */
  latest_image_hash: string;
  /** App version of the newest capture. */
  latest_app_version: string;
}

export interface ScreensResponse {
  screens: ScreenSummary[];
}

/**
 * §19 `POST /query/screen-paths` body — like §15 flows, BUT nodes are SCREENS (the `$screen_name`
 * of `$screen_view` events). Omit `anchor_screen` to start from the top entry screens.
 */
export interface ScreenPathsQuery {
  /** Optional fixed starting screen; omitted → the top entry screens. */
  anchor_screen?: string;
  direction: FlowsDirection;
  date_range: InsightsDateRange;
  steps: number;
  max_nodes_per_step: number;
  unit: FlowsUnit;
  /**
   * Optional §17 per-user identity set (canonical id + aliased anon_ids). When set, the path map is
   * restricted to `distinct_id IN (…)` for an identity-correct per-user screen-path map.
   */
  distinct_ids?: string[];
}

/**
 * Same Sankey shape as §15 flows (`{nodes,links}`): `FlowNode.event` carries the screen name and
 * `FlowNode.id` is `"{step}:{screen_name}"`; `$other`/`$end` are synthetic nodes.
 */
export interface ScreenPathsResponse {
  nodes: FlowNode[];
  links: FlowLink[];
}

/** Click-heatmap grid — `cols`/`rows` each 1..100. */
export interface HeatmapGrid {
  cols: number;
  rows: number;
}

/** §19 `POST /query/click-heatmap` body. */
export interface ClickHeatmapQuery {
  screen_name: string;
  date_range: InsightsDateRange;
  grid: HeatmapGrid;
  filters: InsightsFilter[];
  /**
   * Optional §17 per-user identity set (canonical id + aliased anon_ids). When set, the heatmap is
   * filtered to `distinct_id IN (…)` on the RAW column so a single user's taps are identity-correct.
   */
  distinct_ids?: string[];
}

/** One populated grid cell: `cx`∈0..cols-1, `cy`∈0..rows-1; empty cells are omitted from the response. */
export interface ClickHeatmapCell {
  cx: number;
  cy: number;
  count: number;
}

export interface ClickHeatmapResponse {
  screen_name: string;
  total: number;
  cells: ClickHeatmapCell[];
}

// --- Cohorts/reports/dashboards (contracts §16) ---
// Request/response shapes mirror shared-contracts §16 exactly (the concurrent Phase-5 backend builds
// against the same section, re-validating every stored definition with the §14/§15 zod schemas).
// Cohort/report/dashboard-tile definitions reuse the §14/§15 query-definition types verbatim.

/** `all` = AND across conditions, `any` = OR (contracts §16 cohort definition). */
export type CohortMatch = 'all' | 'any';

export const COHORT_MATCHES: CohortMatch[] = ['all', 'any'];

/** Count comparison for a `behavior` condition — `did event {op} {count} times in the window`. */
export type CohortCountOp = 'gte' | 'gt' | 'lte' | 'lt' | 'eq';

export const COHORT_COUNT_OPS: CohortCountOp[] = ['gte', 'gt', 'lte', 'lt', 'eq'];

export type CohortConditionType = 'behavior' | 'did_not' | 'property';

export const COHORT_CONDITION_TYPES: CohortConditionType[] = ['behavior', 'did_not', 'property'];

/** Did/didn't do an event N times in the last D days, with optional §14 filters (AND-joined). */
export interface CohortBehaviorCondition {
  type: 'behavior';
  event: string;
  op: CohortCountOp;
  count: number;
  within_days: number;
  filters: InsightsFilter[];
}

/** Performed the event 0 times in the window. */
export interface CohortDidNotCondition {
  type: 'did_not';
  event: string;
  within_days: number;
}

/** Latest-known profile / event property match (reuses the §14 filter ops). */
export interface CohortPropertyCondition {
  type: 'property';
  property: string;
  op: InsightsFilterOp;
  value?: string;
}

export type CohortCondition =
  | CohortBehaviorCondition
  | CohortDidNotCondition
  | CohortPropertyCondition;

/** The cohort builder state IS this shape (contracts §16) — 1..10 conditions. */
export interface CohortDefinition {
  match: CohortMatch;
  conditions: CohortCondition[];
}

/** A cohort as listed by `GET /cohorts` — no `definition`. */
export interface CohortSummary {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ListCohortsResponse {
  cohorts: CohortSummary[];
}

/** `GET /cohorts/:id` — the summary plus its stored `definition`. */
export interface Cohort extends CohortSummary {
  definition: CohortDefinition;
}

export interface CreateCohortRequest {
  name: string;
  definition: CohortDefinition;
}

export interface UpdateCohortRequest {
  name?: string;
  definition?: CohortDefinition;
}

/** `GET /cohorts/:id/preview` — resolved size (`uniqExact`) + up to 20 sample distinct_ids. */
export interface CohortPreviewResponse {
  count: number;
  sample: string[];
}

/** The four saved-report kinds; a report's `definition` is the matching §14/§15 query definition. */
export type ReportKind = 'insights' | 'funnel' | 'retention' | 'flows';

export const REPORT_KINDS: ReportKind[] = ['insights', 'funnel', 'retention', 'flows'];

/** A report as listed by `GET /reports` — no `definition`. */
export interface SavedReportSummary {
  id: string;
  name: string;
  kind: ReportKind;
  created_by: string;
  updated_at: string;
}

export interface ListReportsResponse {
  reports: SavedReportSummary[];
}

interface SavedReportBase {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * `GET /reports/:id` — a discriminated union on `kind` so `definition` narrows to the exact §14/§15
 * query-definition type (the union the contract calls the report `definition`).
 */
export type SavedReport =
  | (SavedReportBase & { kind: 'insights'; definition: InsightsQueryDefinition })
  | (SavedReportBase & { kind: 'funnel'; definition: FunnelQueryDefinition })
  | (SavedReportBase & { kind: 'retention'; definition: RetentionQueryDefinition })
  | (SavedReportBase & { kind: 'flows'; definition: FlowsQueryDefinition });

/** Any of the four §14/§15 query definitions — a report/tile `definition` or `inline_definition`. */
export type AnalysisDefinition =
  | InsightsQueryDefinition
  | FunnelQueryDefinition
  | RetentionQueryDefinition
  | FlowsQueryDefinition;

/** `POST /reports` — a discriminated union so `definition` matches `kind`. */
export type CreateReportRequest =
  | { name: string; kind: 'insights'; definition: InsightsQueryDefinition }
  | { name: string; kind: 'funnel'; definition: FunnelQueryDefinition }
  | { name: string; kind: 'retention'; definition: RetentionQueryDefinition }
  | { name: string; kind: 'flows'; definition: FlowsQueryDefinition };

export interface UpdateReportRequest {
  name?: string;
  definition?: AnalysisDefinition;
}

/** `POST /reports/:id/run` body — optional overrides merged over the stored definition. */
export interface RunReportRequest {
  date_range?: InsightsDateRange;
  cohort_id?: string;
}

/** The normal response shape of whichever analysis the report's `kind` names. */
export type AnalysisResult = InsightsResponse | FunnelResponse | RetentionResponse | FlowsResponse;

/** A dashboard as listed by `GET /dashboards`. */
export interface DashboardSummary {
  id: string;
  name: string;
  tile_count: number;
  updated_at: string;
}

export interface ListDashboardsResponse {
  dashboards: DashboardSummary[];
}

export interface CreateDashboardRequest {
  name: string;
}

export interface UpdateDashboardRequest {
  name: string;
}

/**
 * One tile of the 12-column grid. `w`∈1..12, `h`≥1, `x`∈0..11, `x+w`≤12. Exactly one of
 * `saved_report_id` / `inline_definition` is set (enforced server-side); `kind` names the chart.
 */
export interface DashboardTile {
  id: string;
  title: string;
  kind: ReportKind;
  saved_report_id: string | null;
  inline_definition: AnalysisDefinition | null;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
}

/** `GET /dashboards/:id` — the board plus its ordered tiles. */
export interface Dashboard {
  id: string;
  name: string;
  tiles: DashboardTile[];
}

/** `POST /dashboards/:id/tiles` — references a saved report OR carries an inline definition. */
export interface CreateTileRequest {
  title: string;
  kind: ReportKind;
  saved_report_id?: string;
  inline_definition?: AnalysisDefinition;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `PATCH /dashboards/:id/tiles/:tileId` — move / resize / retitle. */
export interface UpdateTileRequest {
  title?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** One entry of the `PATCH /dashboards/:id/layout` batch grid save. */
export interface LayoutTile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
}

export interface UpdateLayoutRequest {
  tiles: LayoutTile[];
}

/** One tile's run result — the analysis response, or an `{ error }` (one tile failing is isolated). */
export interface DashboardTileResult {
  id: string;
  result: AnalysisResult | { error: string };
}

/** `GET /dashboards/:id/data` — every tile's definition run through the engine. */
export interface DashboardDataResponse {
  tiles: DashboardTileResult[];
}

/** Narrows a tile result to the failure branch. */
export function isTileError(
  result: AnalysisResult | { error: string },
): result is { error: string } {
  return 'error' in result;
}

// --- v2 templates (contracts §19) ---
// Amplitude-parity, seeded server-side. `GET /api/v1/templates` is auth-only (not project-scoped);
// applying a template materializes real Cohorts/SavedReports/Dashboard rows (§16) in the project.

/** The fixed §19 template catalog id set. */
export type TemplateId =
  | 'acquisition'
  | 'activation-funnel'
  | 'engagement'
  | 'retention'
  | 'revenue'
  | 'product-usage'
  | 'user-paths';

export const TEMPLATE_IDS: TemplateId[] = [
  'acquisition',
  'activation-funnel',
  'engagement',
  'retention',
  'revenue',
  'product-usage',
  'user-paths',
];

/** How many saved-report definitions of each §14/§15 kind the bundle contains. */
export type TemplateKindCounts = Partial<Record<ReportKind, number>>;

/** One catalog entry from `GET /api/v1/templates`. */
export interface TemplateSummary {
  id: TemplateId;
  name: string;
  description: string;
  kind_counts: TemplateKindCounts;
}

export interface ListTemplatesResponse {
  templates: TemplateSummary[];
}

/** `POST /projects/:projectId/templates/:templateId/apply` — returns the created dashboard's id. */
export interface ApplyTemplateResponse {
  dashboard_id: string;
}
