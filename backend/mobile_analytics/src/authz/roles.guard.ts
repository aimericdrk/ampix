import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ProblemException } from '../common/problem-details';
import type { AuthRequest } from '../auth/auth.types';
import { OrgRoleResolverService, roleRank } from './org-role-resolver.service';
import { ROLES_KEY } from './roles.decorator';

/**
 * Enforces the §13 role matrix. Must run AFTER JwtAuthGuard (class-level guards run before
 * method-level ones in Nest, so `@UseGuards(JwtAuthGuard)` on the controller + `@UseGuards
 * (RolesGuard)` + `@Roles(...)` on the route gives the right order) — a missing/invalid access
 * token is a 401 from JwtAuthGuard, never reaching this guard.
 *
 * Delegates org/role derivation to OrgRoleResolverService: unknown org/project/token -> 404;
 * no membership -> 403; membership present but below the required role -> 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: OrgRoleResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true; // route isn't role-gated

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const userId = req.user!.id;
    const params = req.params as Record<string, string | undefined>;

    const { role } = await this.resolver.resolve(userId, {
      orgId: params.orgId,
      projectId: params.projectId,
      tokenId: params.tokenId,
    });

    if (roleRank(role) < roleRank(required)) {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail: `Requires ${required} role or higher`,
      });
    }
    return true;
  }
}
