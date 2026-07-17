import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { TemplatesService } from './templates.service';
import type { ApplyTemplateResponse, TemplateCatalogResponse } from './templates.types';

/**
 * Templates API (contracts §19). The catalog (`GET /api/v1/templates`) is a global, auth-only read;
 * apply (`POST /api/v1/projects/:projectId/templates/:templateId/apply`) is project-scoped and
 * analyst+ (ProjectRolesGuard resolves the project role from `:projectId`, exactly like the §16
 * controllers). An empty `@Controller()` prefix lets the two routes live at their distinct
 * absolute paths.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('api/v1/templates')
  listCatalog(): TemplateCatalogResponse {
    return this.templates.listCatalog();
  }

  @Post('api/v1/projects/:projectId/templates/:templateId/apply')
  @HttpCode(200) // idempotent action (skip-if-exists), not a fresh resource creation
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async apply(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ): Promise<ApplyTemplateResponse> {
    return this.templates.apply(req.user!.id, projectId, templateId);
  }
}
