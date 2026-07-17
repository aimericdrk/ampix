import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { ReportsModule } from '../reports/reports.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/**
 * Custom dashboards (contracts §16). Imports ReportsModule for the shared AnalysisRunnerService
 * (tiles run through the same injection-safe engine as saved reports).
 */
@Module({
  imports: [AuthModule, AuthzModule, ReportsModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
  // DashboardsService is exported so §19 templates can materialize a dashboard + tiles through it.
  exports: [DashboardsService],
})
export class DashboardsModule {}
