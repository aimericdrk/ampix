import { Module } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';
import { ProjectAccessGuard } from './project-access.guard';

/**
 * Cross-service authz seam consumer: ProjectAccessService forwards the caller's JWT to the
 * analytics backend's internal role-resolution endpoint (backend/src/internal), and
 * ProjectAccessGuard enforces `@RequireProjectRole(...)` on routes that use it — a controller
 * opts in with `@UseGuards(ProjectAccessGuard) @RequireProjectRole('admin')`. AppConfigModule is
 * @Global(), so only these two providers need registering here.
 */
@Module({
  providers: [ProjectAccessService, ProjectAccessGuard],
  exports: [ProjectAccessService, ProjectAccessGuard],
})
export class AuthzModule {}
