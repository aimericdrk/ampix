import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcAdminController } from './rc-admin.controller';
import { RcAdminService } from './rc-admin.service';
import { RcIdentityService } from './rc-identity.service';
import { RcWebhookController } from './rc-webhook.controller';
import { RcWebhookGuard } from './rc-webhook.guard';
import { RcWebhookProcessor } from './rc-webhook.processor';

@Module({
  imports: [AuthModule, AuthzModule, ProjectsModule],
  controllers: [RcWebhookController, RcAdminController],
  providers: [RcWebhookGuard, RcWebhookProcessor, RcIdentityService, ProfileWriter, RcAdminService],
  exports: [RcWebhookProcessor, RcIdentityService],
})
export class RevenueCatModule {}
