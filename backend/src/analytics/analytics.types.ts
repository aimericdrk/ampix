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
