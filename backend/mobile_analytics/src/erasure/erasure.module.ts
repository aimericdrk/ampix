import { Module } from '@nestjs/common';
import { IngestModule } from '../ingestion/ingest.module';
import { ErasureController } from './erasure.controller';
import { ErasureCapabilityGuard } from './erasure-capability.guard';
import { ErasureService } from './erasure.service';

/**
 * End-user data erasure (account deletion / GDPR). IngestModule is imported for the exported
 * SdkTokenGuard + IngestRateLimitGuard (and their SlidingWindowRateLimiter dependency) so the
 * erasure endpoint authenticates and rate-limits exactly like /ingest/events; ClickHouse and
 * Prisma come from their @Global modules.
 */
@Module({
  imports: [IngestModule],
  controllers: [ErasureController],
  providers: [ErasureService, ErasureCapabilityGuard],
  // Exported so the dashboard's admin-gated `DELETE /users/:distinctId` (AnalyticsModule) erases
  // through this exact service rather than a second implementation that could fall behind it.
  exports: [ErasureService],
})
export class ErasureModule {}
