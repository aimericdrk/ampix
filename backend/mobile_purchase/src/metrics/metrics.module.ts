import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { ActiveSubscriptionsController } from './controllers/active-subscriptions.controller';
import { MrrController } from './controllers/mrr.controller';
import { RevenueController } from './controllers/revenue.controller';
import { SummaryController } from './controllers/summary.controller';
import { MetricsService } from './services/metrics.service';
import { SummaryService } from './services/summary.service';

/**
 * Read-only aggregation surface (dashboard-JWT authz seam). AuthzModule provides
 * ProjectAccessGuard for the viewer-gated controllers; PrismaModule is @Global() so PrismaService
 * needs no import here.
 */
@Module({
  imports: [AuthzModule],
  controllers: [RevenueController, MrrController, ActiveSubscriptionsController, SummaryController],
  providers: [MetricsService, SummaryService],
})
export class MetricsModule {}
