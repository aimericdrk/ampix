import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { AnalysisRunnerService } from './analysis-runner.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Saved reports (contracts §16). Imports AnalyticsModule for the injection-safe engine services.
 * Exports {@link AnalysisRunnerService} so dashboards can run tiles through the same engine.
 */
@Module({
  imports: [AuthModule, AuthzModule, AnalyticsModule],
  controllers: [ReportsController],
  providers: [ReportsService, AnalysisRunnerService],
  // ReportsService is exported so §19 templates can materialize saved reports through it.
  exports: [AnalysisRunnerService, ReportsService],
})
export class ReportsModule {}
