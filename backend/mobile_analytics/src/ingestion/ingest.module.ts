import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { EventNormalizer } from './event-normalizer';
import { ProfileWriter } from './profile-writer';
import { SdkTokenGuard } from './sdk-token.guard';
import { IngestRateLimitGuard } from './rate-limit.guard';
import { SlidingWindowRateLimiter } from './rate-limiter';

@Module({
  controllers: [IngestController],
  providers: [
    EventNormalizer,
    ProfileWriter,
    SdkTokenGuard,
    IngestRateLimitGuard,
    SlidingWindowRateLimiter,
  ],
  // Exported so the §18 screenshots ingest controller (ScreenshotsModule) reuses the exact same
  // SDK-token auth + per-token rate limiting as /ingest/events instead of duplicating the guards.
  // SlidingWindowRateLimiter is exported too: it's a constructor dependency of IngestRateLimitGuard,
  // so it must be resolvable wherever that guard is instantiated.
  exports: [SdkTokenGuard, IngestRateLimitGuard, SlidingWindowRateLimiter],
})
export class IngestModule {}
