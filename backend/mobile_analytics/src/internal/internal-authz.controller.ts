import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/tokens/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoleResolverService } from '../authz/project-role-resolver.service';

/**
 * Internal, service-to-service authz seam (not a browser-facing route): other MyAmpix backends
 * (e.g. mobile_purchase) forward the caller's `Authorization: Bearer <jwt>` header here to ask
 * "what role does this user have on this project?" instead of holding JWT_ACCESS_SECRET
 * themselves. ProjectRoleResolverService's exceptions are left to propagate untouched — 404 for
 * an unknown project, 403 for a caller with no membership — so callers must treat any non-200
 * response as a deny, never just a missing `role`.
 */
@Controller('api/v1/internal/projects')
@UseGuards(JwtAuthGuard)
export class InternalAuthzController {
  constructor(private readonly resolver: ProjectRoleResolverService) {}

  @Get(':projectId/role')
  async resolveProjectRole(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ role: ProjectRole }> {
    const role = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    return { role };
  }
}
