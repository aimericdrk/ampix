import { Module } from '@nestjs/common';
import { OrgRoleResolverService } from './org-role-resolver.service';
import { RolesGuard } from './roles.guard';
import { ProjectRoleResolverService } from './project-role-resolver.service';
import { ProjectRolesGuard } from './project-roles.guard';

/**
 * Shared tenancy authorization building blocks (contracts §13): PrismaModule/RedisModule are
 * @Global(), so nothing else needs importing here. Consumers import AuthzModule and use
 * `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` on their org-scoped routes, or
 * `@UseGuards(JwtAuthGuard, ProjectRolesGuard)` + `@ProjectRoles(...)` on their project-scoped
 * routes.
 */
@Module({
  providers: [OrgRoleResolverService, RolesGuard, ProjectRoleResolverService, ProjectRolesGuard],
  exports: [OrgRoleResolverService, RolesGuard, ProjectRoleResolverService, ProjectRolesGuard],
})
export class AuthzModule {}
