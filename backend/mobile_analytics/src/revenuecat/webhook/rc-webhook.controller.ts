import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { RcWebhookGuard, RcWebhookRequest } from './rc-webhook.guard';
import { RcWebhookProcessor } from './rc-webhook.processor';

/** Public endpoint RevenueCat calls; auth = RcWebhookGuard, never JWT (spec §4.2). */
@Controller('webhooks/revenuecat')
@UseGuards(RcWebhookGuard)
export class RcWebhookController {
  constructor(private readonly processor: RcWebhookProcessor) {}

  @Post(':projectId')
  @HttpCode(200)
  async receive(@Req() req: RcWebhookRequest, @Body() body: unknown): Promise<void> {
    await this.processor.process(req.rcIntegration!, body);
  }
}
