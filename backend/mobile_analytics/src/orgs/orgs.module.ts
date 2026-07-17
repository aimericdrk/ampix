import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ProjectsModule } from '../projects/projects.module';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';
import { OrgProjectAccessController } from './project-access/org-project-access.controller';
import { OrgProjectAccessService } from './project-access/org-project-access.service';
import { OrgsController } from './core/orgs.controller';
import { OrgsService } from './core/orgs.service';

@Module({
  // ProjectsModule brought in for ProjectMembersService (exported by it), which
  // OrgProjectAccessService delegates to for the actual per-project membership mutations.
  imports: [AuthModule, AuthzModule, ProjectsModule],
  controllers: [OrgsController, MembersController, OrgProjectAccessController],
  providers: [OrgsService, MembersService, OrgProjectAccessService],
})
export class OrgsModule {}
