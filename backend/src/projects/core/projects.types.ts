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

/** GET /api/v1/projects/:projectId/events/summary response (contracts §12). */
export interface EventsSummary {
  project_id: string;
  total: number;
  by_event: { event: string; count: number }[];
}

/** Per-project list stats: distinct users + the most common `country` super property (or null). */
export interface ProjectStat {
  project_id: string;
  user_count: number;
  top_country: string | null;
}
