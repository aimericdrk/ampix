import { Controller, Delete, Param, Req, UseGuards } from '@nestjs/common';
import { PublicApiKeyGuard, type RequestWithSdkApp } from '../../catalog/public-api-key.guard';
import { ErasureKeyGuard } from '../../common/erasure-key.guard';
import { CustomerDeletionService } from '../services/customer-deletion.service';

/**
 * Server-to-server subscriber erasure (RC parity: `DELETE /v1/subscribers/:appUserId`), called by
 * an app backend when a user deletes their account. PublicApiKeyGuard resolves the project (same
 * as the other /v1 SDK routes); ErasureKeyGuard adds the shared-secret second factor that
 * actually authorizes the destructive delete — the public key alone never does, it ships in the
 * app. Response mirrors RevenueCat's (`{app_user_id, deleted}`) and is idempotent: erasing an
 * unknown subscriber still succeeds so the caller can retry safely.
 */
@Controller('v1')
@UseGuards(PublicApiKeyGuard, ErasureKeyGuard)
export class SubscriberDeletionController {
  constructor(private readonly service: CustomerDeletionService) {}

  @Delete('subscribers/:appUserId')
  async deleteSubscriber(@Req() req: RequestWithSdkApp, @Param('appUserId') appUserId: string) {
    await this.service.removeByAppUserId(req.sdkApp.projectId, appUserId);
    return { app_user_id: appUserId, deleted: true };
  }
}
