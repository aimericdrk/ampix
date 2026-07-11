import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ProjectsModule } from '../projects/projects.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrgProjectAccessController } from './org-project-access.controller';
import { OrgProjectAccessService } from './org-project-access.service';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  // ProjectsModule brought in for ProjectMembersService (exported by it), which
  // OrgProjectAccessService delegates to for the actual per-project membership mutations.
  imports: [AuthModule, AuthzModule, ProjectsModule],
  controllers: [OrgsController, MembersController, OrgProjectAccessController],
  providers: [OrgsService, MembersService, OrgProjectAccessService],
})
export class OrgsModule {}
