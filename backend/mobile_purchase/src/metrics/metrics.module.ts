import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { ActiveSubscriptionsController } from './controllers/active-subscriptions.controller';
import { MrrController } from './controllers/mrr.controller';
import { RevenueController } from './controllers/revenue.controller';
import { MetricsService } from './services/metrics.service';

/**
 * Read-only aggregation surface (dashboard-JWT authz seam). AuthzModule provides
 * ProjectAccessGuard for the viewer-gated controllers; PrismaModule is @Global() so PrismaService
 * needs no import here. First aggregation code in the service.
 */
@Module({
  imports: [AuthzModule],
  controllers: [RevenueController, MrrController, ActiveSubscriptionsController],
  providers: [MetricsService],
})
export class MetricsModule {}
