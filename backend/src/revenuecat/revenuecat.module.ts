import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ProjectsModule } from '../projects/projects.module';
import { CohortsModule } from '../cohorts/cohorts.module';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcAdminController } from './rc-admin.controller';
import { RcAdminService } from './rc-admin.service';
import { RcApiClient } from './rc-api.client';
import { RcBackfillService } from './rc-backfill.service';
import { RcIdentityService } from './rc-identity.service';
import { RcWebhookController } from './rc-webhook.controller';
import { RcWebhookGuard } from './rc-webhook.guard';
import { RcWebhookProcessor } from './rc-webhook.processor';

@Module({
  imports: [AuthModule, AuthzModule, ProjectsModule, CohortsModule],
  controllers: [RcWebhookController, RcAdminController],
  providers: [
    RcWebhookGuard,
    RcWebhookProcessor,
    RcIdentityService,
    ProfileWriter,
    // Factory, not a bare class token: RcApiClient's ctor param type (`typeof fetch`) isn't a
    // resolvable DI token, so plain `useClass` registration would fail Nest's dependency scan.
    { provide: RcApiClient, useFactory: () => new RcApiClient() },
    RcBackfillService,
    RcAdminService,
  ],
  exports: [RcWebhookProcessor, RcIdentityService],
})
export class RevenueCatModule {}
