/** POST /api/v1/orgs/:orgId/projects response (contracts §13). */
export interface CreatedProject {
  id: string;
  org_id: string;
  name: string;
  timezone: string;
  ingest_token: string;
}

/** PATCH /api/v1/projects/:projectId response (contracts §13). */
export interface UpdatedProject {
  id: string;
  name: string;
  timezone: string;
}

/** POST /api/v1/projects/:projectId/data/purge response — which scopes were actually cleared. */
export interface PurgeDataResult {
  cleared: {
    analytics: boolean;
    revenuecat: boolean;
    saved: boolean;
  };
}

/** GET /api/v1/projects/:projectId/tokens list item (contracts §13) — non-revoked only. */
export interface SdkTokenListItem {
  id: string;
  token: string;
  label: string;
  created_at: string;
}

/** POST /api/v1/projects/:projectId/tokens response (contracts §13). */
export interface CreatedToken {
  id: string;
  token: string;
  label: string;
}
