import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { CohortsModule } from '../cohorts/cohorts.module';
import { ErasureModule } from '../erasure/erasure.module';
import { ProjectsModule } from '../projects/projects.module';
import { AttributionService } from './queries/attribution/attribution.service';
import { ExperimentsService } from './queries/experiments/experiments.service';
import { UserAdminService } from './services/user-admin.service';
import { AdvancedAnalyticsController } from './controllers/advanced-analytics.controller';
import { AdvancedAnalyticsService } from './services/advanced-analytics.service';
import { MistralService } from './ai/mistral.service';
import { JourneyController } from './journey/journey.controller';
import { JourneyService } from './journey/journey.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { AnalyticsService } from './services/analytics.service';
import { InsightsQueryService } from './services/insights-query.service';
import { MetadataService } from './services/metadata.service';
import { SummariesService } from './services/summaries.service';
import { UsersService } from './services/users.service';
import { V2AnalyticsController } from './controllers/v2-analytics.controller';
import { V2AnalyticsService } from './services/v2-analytics.service';

/**
 * AuthzModule supplies ProjectRolesGuard for the admin-gated hide/erase routes (every other route
 * here is a viewer+ read that checks membership inside the service). ErasureModule supplies the
 * SAME ErasureService the server-token GDPR endpoint uses, so dashboard-initiated deletion and
 * app-initiated deletion cannot drift apart.
 */
@Module({
  imports: [AuthModule, AuthzModule, ProjectsModule, CohortsModule, ErasureModule],
  controllers: [
    AnalyticsController,
    AdvancedAnalyticsController,
    V2AnalyticsController,
    JourneyController,
  ],
  providers: [
    MetadataService,
    UserAdminService,
    AttributionService,
    ExperimentsService,
    UsersService,
    SummariesService,
    InsightsQueryService,
    AnalyticsService,
    AdvancedAnalyticsService,
    V2AnalyticsService,
    JourneyService,
    MistralService,
  ],
  // Exported so the §16 saved-reports/dashboards runner can execute stored definitions through the
  // exact same injection-safe engine (re-validating on every run).
  exports: [AnalyticsService, AdvancedAnalyticsService],
})
export class AnalyticsModule {}
