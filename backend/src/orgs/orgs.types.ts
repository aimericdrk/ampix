import type { Role } from '@prisma/client';

/** POST /api/v1/orgs response (contracts §13). */
export interface CreatedOrg {
  id: string;
  name: string;
  role: Role;
}

/** GET /api/v1/orgs list item (contracts §13). */
export interface OrgListItem {
  id: string;
  name: string;
  role: Role;
}

/** PATCH /api/v1/orgs/:orgId response (contracts §13). */
export interface RenamedOrg {
  id: string;
  name: string;
}
