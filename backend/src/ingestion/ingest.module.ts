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
})
export class IngestModule {}
