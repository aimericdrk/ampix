import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { CohortsController } from './cohorts.controller';
import { CohortsService } from './cohorts.service';

/**
 * Cohorts (contracts §16). Exports {@link CohortsService} so the analytics engine can resolve the
 * optional `cohort_id` filter (and reports/dashboards can reuse it). PrismaModule/ClickHouseModule
 * are @Global(), so only the auth/authz building blocks need importing.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [CohortsController],
  providers: [CohortsService],
  exports: [CohortsService],
})
export class CohortsModule {}
