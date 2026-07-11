import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ProjectManagementController } from './project-management.controller';
import { ProjectManagementService } from './project-management.service';
import { ProjectMembersController } from './project-members.controller';
import { ProjectMembersService } from './project-members.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [ProjectsController, ProjectManagementController, ProjectMembersController],
  providers: [ProjectsService, ProjectManagementService, ProjectMembersService],
  // ProjectsService exported so AnalyticsModule (contracts §14) can reuse `assertMembership`
  // instead of duplicating the 404-then-403 tenancy check. ProjectMembersService exported so
  // OrgsModule's OrgProjectAccessService can delegate to it (owner-safety + serializable guards)
  // for org-scoped per-project access management.
  exports: [ProjectsService, ProjectMembersService],
})
export class ProjectsModule {}
