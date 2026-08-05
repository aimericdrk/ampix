import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { ReportsModule } from '../reports/reports.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Templates (contracts §19). Reuses the §16 ReportsService/DashboardsService to materialize a
 * bundle, so applied reports/dashboards go through the SAME validation + project scoping as manual
 * creation. PrismaModule is @Global() (used for the skip-if-exists idempotency check).
 */
@Module({
  imports: [AuthModule, AuthzModule, ReportsModule, DashboardsModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
