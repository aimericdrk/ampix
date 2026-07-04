import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'requiredRole';

/**
 * Marks a route with the MINIMUM Membership role required to call it (contracts §13 role
 * matrix: admin > analyst > viewer — "a route needs role >= the required level"). Read by
 * RolesGuard, which must also be attached to the route (`@UseGuards(RolesGuard)`).
 */
export const Roles = (role: Role) => SetMetadata(ROLES_KEY, role);
