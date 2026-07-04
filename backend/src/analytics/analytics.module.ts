import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CohortsModule } from '../cohorts/cohorts.module';
import { ProjectsModule } from '../projects/projects.module';
import { AdvancedAnalyticsController } from './advanced-analytics.controller';
import { AdvancedAnalyticsService } from './advanced-analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [AuthModule, ProjectsModule, CohortsModule],
  controllers: [AnalyticsController, AdvancedAnalyticsController],
  providers: [AnalyticsService, AdvancedAnalyticsService],
  // Exported so the §16 saved-reports/dashboards runner can execute stored definitions through the
  // exact same injection-safe engine (re-validating on every run).
  exports: [AnalyticsService, AdvancedAnalyticsService],
})
export class AnalyticsModule {}
