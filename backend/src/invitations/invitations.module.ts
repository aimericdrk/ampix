import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { OrgInvitationsController } from './org-invitations.controller';

@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [OrgInvitationsController, InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
