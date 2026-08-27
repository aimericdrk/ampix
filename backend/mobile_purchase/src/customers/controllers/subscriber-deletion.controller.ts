import { Controller, Delete, Param, Req, UseGuards } from '@nestjs/common';
import { ServerKeyGuard, type RequestWithServerKey } from '../../server-keys/server-key.guard';
import { ErasureCapabilityGuard } from '../../server-keys/erasure-capability.guard';
import { CustomerDeletionService } from '../services/customer-deletion.service';

/**
 * Server-to-server subscriber erasure (RC parity: `DELETE /v1/subscribers/:appUserId`), called by
 * an app backend when a user deletes their account. Authenticated by the project's own ServerKey —
 * NOT the public SDK key the other /v1 routes use, which ships inside the app — and authorized by
 * the erasure capability on that key. Both the project scope and the capability come from the key
 * row, so this needs no shared secret: the credential is per-project and minted in the dashboard.
 *
 * Response mirrors RevenueCat's (`{app_user_id, deleted}`) and is idempotent: erasing an unknown
 * subscriber still succeeds so the caller can retry safely.
 */
@Controller('v1')
@UseGuards(ServerKeyGuard, ErasureCapabilityGuard)
export class SubscriberDeletionController {
  constructor(private readonly service: CustomerDeletionService) {}

  @Delete('subscribers/:appUserId')
  async deleteSubscriber(@Req() req: RequestWithServerKey, @Param('appUserId') appUserId: string) {
    await this.service.removeByAppUserId(req.serverKey.projectId, appUserId);
    return { app_user_id: appUserId, deleted: true };
  }
}
