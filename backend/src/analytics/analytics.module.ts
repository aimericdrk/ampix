import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CohortsModule } from '../cohorts/cohorts.module';
import { ProjectsModule } from '../projects/projects.module';
import { AdvancedAnalyticsController } from './controllers/advanced-analytics.controller';
import { AdvancedAnalyticsService } from './services/advanced-analytics.service';
import { MistralService } from './ai/mistral.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { AnalyticsService } from './services/analytics.service';
import { InsightsQueryService } from './services/insights-query.service';
import { MetadataService } from './services/metadata.service';
import { SummariesService } from './services/summaries.service';
import { UsersService } from './services/users.service';
import { V2AnalyticsController } from './controllers/v2-analytics.controller';
import { V2AnalyticsService } from './services/v2-analytics.service';

@Module({
  imports: [AuthModule, ProjectsModule, CohortsModule],
  controllers: [AnalyticsController, AdvancedAnalyticsController, V2AnalyticsController],
  providers: [
    MetadataService,
    UsersService,
    SummariesService,
    InsightsQueryService,
    AnalyticsService,
    AdvancedAnalyticsService,
    V2AnalyticsService,
    MistralService,
  ],
  // Exported so the §16 saved-reports/dashboards runner can execute stored definitions through the
  // exact same injection-safe engine (re-validating on every run).
  exports: [AnalyticsService, AdvancedAnalyticsService],
})
export class AnalyticsModule {}
