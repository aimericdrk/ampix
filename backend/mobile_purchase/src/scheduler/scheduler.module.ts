import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionExpirySweepService } from '../subscriptions/subscription-expiry-sweep.service';
import { ExpirySweepJob } from './expiry-sweep.job';

/**
 * D2 scheduler skeleton (design §1). `ScheduleModule.forRoot()` provides `SchedulerRegistry`;
 * `ExpirySweepJob` registers a config-driven cron over `SubscriptionExpirySweepService`.
 * `PrismaModule` is global, so the sweep service's `PrismaService` resolves without an import here.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ExpirySweepJob, SubscriptionExpirySweepService],
})
export class SchedulerModule {}
