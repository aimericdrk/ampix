import type { Role } from '@prisma/client';

/** POST /api/v1/orgs/:orgId/invitations response (contracts §13). */
export interface CreatedInvitation {
  id: string;
  role: Role;
  token: string;
  invite_path: string;
  expires_at: string;
}

/** GET /api/v1/orgs/:orgId/invitations list item (contracts §13) — pending only. */
export interface InvitationListItem {
  id: string;
  role: Role;
  expires_at: string;
}

/** GET /api/v1/invitations/:token (public) response (contracts §13). */
export interface PublicInvitation {
  org_name: string;
  role: Role;
  expires_at: string;
}

/** POST /api/v1/invitations/:token/accept response (contracts §13). */
export interface AcceptedInvitation {
  org_id: string;
  role: Role;
}
