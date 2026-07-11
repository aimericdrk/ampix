import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { Roles } from '../authz/roles.decorator';
import { RolesGuard } from '../authz/roles.guard';
import { OrgRoleResolverService } from '../authz/org-role-resolver.service';
import { setProjectAccessSchema } from './org-project-access.schemas';
import { OrgProjectAccessService } from './org-project-access.service';
import type { ListProjectAccessResponse } from './org-project-access.types';

@Controller('api/v1/orgs/:orgId/members/:userId/project-access')
@UseGuards(JwtAuthGuard)
export class OrgProjectAccessController {
  constructor(
    private readonly access: OrgProjectAccessService,
    private readonly resolver: OrgRoleResolverService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async list(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ): Promise<ListProjectAccessResponse> {
    return this.access.list(orgId, userId);
  }

  @Put(':projectId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async set(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<{ projectId: string; role: string | null }> {
    const dto = parseOrThrow(setProjectAccessSchema, body);
    const { role: actorOrgRole } = await this.resolver.resolve(req.user!.id, { orgId });
    return this.access.set(orgId, req.user!.id, actorOrgRole, userId, projectId, dto.role);
  }
}
