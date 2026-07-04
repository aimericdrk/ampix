import { Module } from '@nestjs/common';
import { OrgRoleResolverService } from './org-role-resolver.service';
import { RolesGuard } from './roles.guard';

/**
 * Shared tenancy authorization building blocks (contracts §13): PrismaModule/RedisModule are
 * @Global(), so nothing else needs importing here. Consumers import AuthzModule and use
 * `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` on their routes.
 */
@Module({
  providers: [OrgRoleResolverService, RolesGuard],
  exports: [OrgRoleResolverService, RolesGuard],
})
export class AuthzModule {}
