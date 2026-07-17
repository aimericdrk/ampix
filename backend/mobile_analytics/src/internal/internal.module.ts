import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { InternalAuthzController } from './internal-authz.controller';

/**
 * Cross-service authz seam: exposes `GET /api/v1/internal/projects/:projectId/role` so other
 * MyAmpix backends (mobile_purchase) can resolve a caller's project role by forwarding their
 * JWT, without holding JWT_ACCESS_SECRET themselves. AuthModule is imported (mirrors
 * CohortsModule) because JwtAuthGuard needs TokenService; AuthzModule provides
 * ProjectRoleResolverService. PrismaModule is @Global(), so nothing else needs importing here.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [InternalAuthzController],
})
export class InternalModule {}
