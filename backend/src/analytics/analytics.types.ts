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

/** GET /events/live response (contracts §14). */
export interface LiveEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  os: string;
  app_version: string;
}

export interface LiveEventsResponse {
  events: LiveEvent[];
  next_before: string | null;
}

/** GET /users response (contracts §14). */
export interface UserListItem {
  distinct_id: string;
  last_seen: string;
  event_count: number;
}

export interface UsersResponse {
  users: UserListItem[];
  next_cursor: string | null;
}

/** GET /users/:distinctId response (contracts §14). */
export interface RecentEvent {
  insert_id: string;
  event: string;
  timestamp: string;
}

export interface UserProfileResponse {
  distinct_id: string;
  profile: Record<string, unknown>;
  first_seen: string | null;
  last_seen: string | null;
  event_count: number;
  recent_events: RecentEvent[];
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
