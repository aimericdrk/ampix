import { Module } from '@nestjs/common';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcIdentityService } from './rc-identity.service';
import { RcWebhookController } from './rc-webhook.controller';
import { RcWebhookGuard } from './rc-webhook.guard';
import { RcWebhookProcessor } from './rc-webhook.processor';

@Module({
  controllers: [RcWebhookController],
  providers: [RcWebhookGuard, RcWebhookProcessor, RcIdentityService, ProfileWriter],
  exports: [RcWebhookProcessor, RcIdentityService],
})
export class RevenueCatModule {}
