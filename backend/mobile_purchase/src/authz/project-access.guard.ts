import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ProblemException } from '../common/problem-details';
import { ProjectAccessService, projectRoleRank, type ProjectRole } from './project-access.service';
import { REQUIRE_PROJECT_ROLE_KEY } from './require-project-role.decorator';

function unauthorized(): ProblemException {
  return new ProblemException({
    status: 401,
    title: 'Unauthorized',
    detail: 'Missing Authorization header',
  });
}

function forbidden(required: ProjectRole): ProblemException {
  return new ProblemException({
    status: 403,
    title: 'Forbidden',
    detail: `Requires ${required} project role or higher`,
  });
}

/**
 * Cross-service authz seam: enforces `@RequireProjectRole(...)` on `:projectId`-scoped routes
 * by delegating the role check to ProjectAccessService, which in turn asks the analytics
 * backend's internal role-resolution endpoint. mobile_purchase never verifies the JWT itself —
 * a missing Authorization header is rejected here (401) before any network call is made; any
 * deny from analytics (unknown project / non-member / invalid credentials) surfaces as 403.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProjectRole | undefined>(
      REQUIRE_PROJECT_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw unauthorized();
    }

    const projectId = (req.params as Record<string, string | undefined>).projectId;
    const role = projectId
      ? await this.projectAccess.getProjectRole(projectId, authHeader)
      : null;

    if (!role || projectRoleRank(role) < projectRoleRank(required)) {
      throw forbidden(required);
    }
    return true;
  }
}
