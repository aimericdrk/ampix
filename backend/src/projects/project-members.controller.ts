import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { ProjectRoleResolverService } from '../authz/project-role-resolver.service';
import { addProjectMemberSchema, updateProjectMemberRoleSchema } from './project-members.schemas';
import { ProjectMembersService } from './project-members.service';
import type { ProjectMemberListItem, UpdatedProjectMember } from './project-members.types';

@Controller('api/v1/projects/:projectId/members')
@UseGuards(JwtAuthGuard)
export class ProjectMembersController {
  constructor(
    private readonly members: ProjectMembersService,
    private readonly resolver: ProjectRoleResolverService,
  ) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async list(@Param('projectId') projectId: string): Promise<{ members: ProjectMemberListItem[] }> {
    return { members: await this.members.list(projectId) };
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async add(@Req() req: AuthRequest, @Param('projectId') projectId: string, @Body() body: unknown): Promise<UpdatedProjectMember> {
    const dto = parseOrThrow(addProjectMemberSchema, body);
    const actorRole = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    return this.members.add(projectId, actorRole, dto.userId, dto.role);
  }

  @Patch(':userId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async changeRole(@Req() req: AuthRequest, @Param('projectId') projectId: string, @Param('userId') userId: string, @Body() body: unknown): Promise<UpdatedProjectMember> {
    const dto = parseOrThrow(updateProjectMemberRoleSchema, body);
    const actorRole = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    return this.members.changeRole(projectId, req.user!.id, actorRole, userId, dto.role);
  }

  @Delete(':userId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(204)
  async remove(@Req() req: AuthRequest, @Param('projectId') projectId: string, @Param('userId') userId: string): Promise<void> {
    const actorRole = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    await this.members.remove(projectId, actorRole, userId);
  }
}
