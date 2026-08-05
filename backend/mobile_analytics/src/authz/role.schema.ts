import { z } from 'zod';

/** The three §13 invitable Membership roles, in the shape client bodies send them. */
export const roleSchema = z.enum(['admin', 'analyst', 'viewer']);

/** Full org role set incl. `owner` — used where a member's role can be set to owner (transfer). */
export const orgRoleSchema = z.enum(['owner', 'admin', 'analyst', 'viewer']);
