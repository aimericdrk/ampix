import type { Role } from '@prisma/client';

/** GET /api/v1/orgs/:orgId/members list item (contracts §13). */
export interface MemberListItem {
  user: { id: string; email: string; name: string };
  role: Role;
}

/** PATCH /api/v1/orgs/:orgId/members/:userId response (contracts §13 leaves the shape open; this
 *  echoes back what changed). */
export interface UpdatedMember {
  user_id: string;
  role: Role;
}
