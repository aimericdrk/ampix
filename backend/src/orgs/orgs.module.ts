import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [OrgsController, MembersController],
  providers: [OrgsService, MembersService],
})
export class OrgsModule {}
