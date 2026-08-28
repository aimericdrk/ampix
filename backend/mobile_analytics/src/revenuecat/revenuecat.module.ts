import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ProjectsModule } from '../projects/projects.module';
import { CohortsModule } from '../cohorts/cohorts.module';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcAdminController } from './admin/rc-admin.controller';
import { RcAdminService } from './admin/rc-admin.service';
import { RcApiClient } from './api/rc-api.client';
import { RcBackfillService } from './backfill/rc-backfill.service';
import { RcIdentityService } from './identity/rc-identity.service';
import { RcJourneyController } from './journey/rc-journey.controller';
import { RcJourneyService } from './journey/rc-journey.service';
import { RcAttributionService } from './metrics/rc-attribution.service';
import { RcMetricsController } from './metrics/rc-metrics.controller';
import { RcMetricsService } from './metrics/rc-metrics.service';
import { RcSummaryService } from './metrics/rc-summary.service';
import { RcWebhookController } from './webhook/rc-webhook.controller';
import { RcWebhookGuard } from './webhook/rc-webhook.guard';
import { RcWebhookProcessor } from './webhook/rc-webhook.processor';

@Module({
  imports: [AnalyticsModule, AuthModule, AuthzModule, ProjectsModule, CohortsModule],
  controllers: [RcWebhookController, RcAdminController, RcMetricsController, RcJourneyController],
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
    RcSummaryService,
    RcAttributionService,
    RcJourneyService,
    RcMetricsService,
  ],
  exports: [RcWebhookProcessor, RcIdentityService],
})
export class RevenueCatModule {}
