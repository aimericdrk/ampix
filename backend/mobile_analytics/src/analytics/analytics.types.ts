import type { InsightsQuery } from './queries/insights/insights-query.schema';

/** POST /query/insights response (contracts §14). */
export interface InsightsSeriesPoint {
  t: string;
  value: number;
}

export interface InsightsSeries {
  name: string;
  breakdown_value: string | null;
  data: InsightsSeriesPoint[];
}

export interface InsightsResponse {
  series: InsightsSeries[];
}

/** GET /meta/events response (contracts §14). */
export interface EventsMetaResponse {
  events: string[];
}

/** GET /meta/properties response (contracts §14). */
export interface PropertyMeta {
  name: string;
  type: 'string' | 'number' | 'column';
}

export interface PropertiesMetaResponse {
  properties: PropertyMeta[];
}

/** GET /meta/property-values response (contracts §14) — distinct values of one property. */
export interface PropertyValuesResponse {
  values: string[];
}

/** GET /events/live response (contracts §14). */
export interface LiveEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  os: string;
  app_version: string;
  /** 'client' (SDK-emitted) or 'server' (backend-emitted) — see EVENT_SOURCE_EXPR. */
  source: string;
}

export interface LiveEventsResponse {
  events: LiveEvent[];
  next_before: string | null;
}

/** GET /users response (contracts §14). */
export interface UserListItem {
  distinct_id: string;
  first_seen: string;
  last_seen: string;
  event_count: number;
  /** From the user's `user_profiles` row (§17 canonical id); null when absent/empty. */
  name: string | null;
  /** From the user's `user_profiles` row (§17 canonical id); null when absent/empty. */
  email: string | null;
  /**
   * From the user's `user_profiles` row (§17 canonical id), coalescing the accepted spellings in
   * `USER_PHONE_PROFILE_KEYS`; null when absent/empty. Shown under the name as the contact line's
   * fallback when the profile has no email.
   */
  phone: string | null;
}

export interface UsersResponse {
  users: UserListItem[];
  next_cursor: string | null;
}

/** One entry of `GET /users/hidden` — a user removed from the audience surfaces, reversibly. */
export interface HiddenUserListItem {
  /** The CANONICAL id (§17) that was hidden — resolved at hide time, not the id that was clicked. */
  distinct_id: string;
  hidden_at: string;
  /** The dashboard user who hid them; null when that account has since been deleted. */
  hidden_by: string | null;
}

export interface HiddenUsersResponse {
  users: HiddenUserListItem[];
}

/**
 * `DELETE /users/:distinctId/events/:insertId` — the one event that was removed, echoed back as the
 * server stored it (not as the client believed it to be), so the confirmation an operator sees is
 * the server's account of what it deleted.
 */
export interface DeletedEventResponse {
  insert_id: string;
  event: string;
  /** The deleted row's `timestamp`, as an ISO-8601 instant like every other API timestamp. */
  timestamp: string;
}

/** Device/app context captured with an event (the §5 context columns), surfaced per recent event. */
export interface RecentEventContext {
  os: string;
  os_version: string;
  app_version: string;
  app_build: string;
  device_model: string;
  device_manufacturer: string;
  locale: string;
  timezone: string;
  network: string;
  sdk_version: string;
  /**
   * The address the event was received from, captured server-side at ingest. '' when it is not
   * known — nothing was forwarded, or the row predates the column.
   */
  ip: string;
}

/** GET /users/:distinctId response (contracts §14). */
export interface RecentEvent {
  insert_id: string;
  event: string;
  timestamp: string;
  /**
   * The SDK's session id. Consecutive events sharing one are a single visit to the app; a change
   * means the app was away long enough (default 30 min backgrounded) to start a new session, which
   * is what lets the timeline show where the user quit and came back.
   */
  session_id: string;
  /** The `$screen_name` of `$screen_view`/`$tap` events; null for events without one. */
  screen_name: string | null;
  /** Every custom property (contracts §4 flat map) attached to this event, verbatim. */
  properties: Record<string, unknown>;
  /** The device/app context captured with the event. */
  context: RecentEventContext;
}

export interface UserProfileResponse {
  distinct_id: string;
  profile: Record<string, unknown>;
  first_seen: string | null;
  last_seen: string | null;
  event_count: number;
  recent_events: RecentEvent[];
  /**
   * §17 identity set — the canonical id plus every anon_id aliasing to it; feed to the click-heatmap
   * `distinct_ids` for identity-correct per-user results.
   */
  distinct_ids: string[];
  /**
   * True when this user is hidden from the audience surfaces (§17 soft remove). The profile itself
   * still resolves — 404ing it would leave no way back to the "un-hide" action once the user has
   * dropped out of every list that links here.
   */
  hidden: boolean;
}

/**
 * GET /users/:distinctId/events response — the same rows as `recent_events`, keyset-paginated so
 * the profile timeline can page backwards instead of stopping at its first 50.
 */
export interface UserEventsResponse {
  events: RecentEvent[];
  /**
   * Feed back as `before` to get the next (older) page; `null` when the last page was reached.
   * A composite cursor, not a bare timestamp: a batching SDK regularly writes several events in
   * the same millisecond, and `timestamp < last` would silently drop every tied row.
   */
  next_before: { timestamp: string; insert_id: string } | null;
}

/** GET /sessions/summary response (contracts §14). */
export interface SessionsByDay {
  t: string;
  sessions: number;
  avg_duration_ms: number;
}

export interface SessionsSummaryResponse {
  sessions: number;
  avg_duration_ms: number;
  by_day: SessionsByDay[];
}

/** GET /metrics/revenue response (contracts §19) — derived from `$in_app_purchase` events. */
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

export interface RevenueSummaryResponse {
  total_revenue: number;
  purchases: number;
  paying_users: number;
  arppu: number;
  avg_purchase_value: number;
  by_day: RevenueByDay[];
  by_product: RevenueByProduct[];
}

/** POST /query/funnels response (contracts §15). */
export interface FunnelStepResult {
  event: string;
  count: number;
  /** `count / prev_count` (`1.0` for step 0, `0` when the denominator is `0`). */
  conversion_from_prev: number;
  /** `count / step0_count` (`1.0` for step 0, `0` when the denominator is `0`). */
  conversion_from_top: number;
}

export interface FunnelBreakdownResult {
  value: string;
  steps: FunnelStepResult[];
  overall_conversion: number;
}

export interface FunnelResponse {
  steps: FunnelStepResult[];
  overall_conversion: number;
  /** Present only when a `breakdown` is requested. */
  breakdowns?: FunnelBreakdownResult[];
}

/** POST /query/retention response (contracts §15). */
export interface RetentionPeriodCell {
  period: number;
  count: number;
  rate: number;
}

export interface RetentionCohort {
  cohort: string;
  size: number;
  periods: RetentionPeriodCell[];
}

export interface RetentionAverage {
  period: number;
  rate: number;
}

export interface RetentionResponse {
  cohorts: RetentionCohort[];
  averages: RetentionAverage[];
}

/** POST /query/flows response (contracts §15). Sankey-ready; node ids are `"step:event"`. */
export interface FlowNode {
  id: string;
  step: number;
  event: string;
  value: number;
}

export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

export interface FlowResponse {
  nodes: FlowNode[];
  links: FlowLink[];
}

/** POST /query/click-heatmap response (contracts §19). Empty grid cells are omitted; `cx`/`cy` are
 *  0-based cell indices (`cx` 0..cols-1, `cy` 0..rows-1). */
export interface HeatmapCell {
  cx: number;
  cy: number;
  count: number;
}

export interface ClickHeatmapResponse {
  screen_name: string;
  /** Total taps counted (sum of every cell's count — i.e. qualifying `$tap`s after dropping 0-size screens). */
  total: number;
  cells: HeatmapCell[];
}

/**
 * POST /query/tap-elements response — what was tapped on a screen, ranked. The positional
 * companion to the click-heatmap, and the reliable one on screens taller than the viewport, where
 * a tap's recorded position has no scroll offset to place it by.
 */
export interface TapElement {
  /** `$widget_type` — e.g. `ElevatedButton`. Empty when the tap hit no identifiable widget. */
  widget_type: string;
  /** `$widget_label` — the visible text, when the widget had one. Empty otherwise. */
  widget_label: string;
  /** Taps on this element. */
  count: number;
  /** Distinct raw ids that tapped it (not canonicalized — same rule as the heatmap's filter). */
  users: number;
}

export interface TapElementsResponse {
  screen_name: string;
  /** Total taps across the returned elements — NOT the screen's total if `limit` truncated. */
  total: number;
  /** True when more elements existed than `limit` returned, so `total` is a partial sum. */
  truncated: boolean;
  elements: TapElement[];
}

/** GET /metrics/engagement response (contracts §19). All user counts use the canonical `uid` (§17). */
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

/** POST /query/histogram response (contracts §19). `buckets` is the adaptive ClickHouse
 *  `histogram()` output (empty when no matching/finite-valued events); the summary stats are `0`
 *  when there is no data. */
export interface HistogramBucket {
  lower: number;
  upper: number;
  count: number;
}

export interface HistogramResponse {
  buckets: HistogramBucket[];
  total: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
}

/** POST /query/ask response (feat-17 §3.1 — "Ask your data"). The model's answer, already
 *  validated against `insightsQuerySchema`, so the client can run it via `/query/insights` (and
 *  edit it first — it's never a black box). */
export interface AskResponse {
  question: string;
  definition: InsightsQuery;
}
