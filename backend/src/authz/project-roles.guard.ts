import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ProjectRole } from '@prisma/client';
import { ProblemException } from '../common/problem-details';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoleResolverService, projectRoleRank } from './project-role-resolver.service';
import { PROJECT_ROLES_KEY } from './project-roles.decorator';

@Injectable()
export class ProjectRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: ProjectRoleResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProjectRole | undefined>(PROJECT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const params = req.params as Record<string, string | undefined>;
    const { role } = await this.resolver.resolve(req.user!.id, {
      projectId: params.projectId,
      tokenId: params.tokenId,
    });
    if (projectRoleRank(role) < projectRoleRank(required)) {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail: `Requires ${required} project role or higher`,
      });
    }
    return true;
  }
}
