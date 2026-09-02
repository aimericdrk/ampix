import type { ProjectRole } from '@prisma/client';

/** GET /api/v1/projects list item (contracts §12). */
export interface ProjectListItem {
  id: string;
  org_id: string;
  org_name: string;
  name: string;
  timezone: string;
  ingest_token: string | null;
  role: ProjectRole;
  integrations: { revenuecat: boolean };
}

/** One `by_event` row: an event name, its all-time volume, and that volume split by emitter. */
export interface EventsSummaryRow {
  event: string;
  count: number;
  /** Rows emitted by the SDK. `client_count + server_count === count`. */
  client_count: number;
  /** Rows emitted by a backend (the app's server, the RevenueCat webhook writer). */
  server_count: number;
}

/** GET /api/v1/projects/:projectId/events/summary response (contracts §12). */
export interface EventsSummary {
  project_id: string;
  total: number;
  by_event: EventsSummaryRow[];
}

/** Per-project list stats: distinct users + the most common `country` super property (or null). */
export interface ProjectStat {
  project_id: string;
  user_count: number;
  top_country: string | null;
}
