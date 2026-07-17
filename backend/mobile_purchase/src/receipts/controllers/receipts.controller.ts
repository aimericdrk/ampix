import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { PublicApiKeyGuard, type RequestWithSdkApp } from '../../catalog/public-api-key.guard';
import { parseOrThrow } from '../../common/zod';
import { submitReceiptBodySchema } from '../support/receipts.schemas';
import { ReceiptsService } from '../services/receipts.service';

/**
 * PUBLIC, key-authenticated SDK receipt intake (design §5's `POST /v1/receipts`) — RevenueCat's
 * primary attribution path: validates the receipt against the store synchronously (no waiting for
 * the async webhook), persists it, binds the store token to the Customer, replays any previously
 * UNLINKED webhooks for the same purchase, and returns the SAME `{ customerInfo }` envelope
 * `GET /v1/subscribers/:appUserId` does (M5a's `CustomerInfoAssemblerService`, reused verbatim —
 * the design principle this whole endpoint follows: "do EXACTLY what RevenueCat does").
 *
 * Authenticated by `PublicApiKeyGuard` (`App.publicSdkKey`), exactly like `/v1/offerings` and
 * `/v1/subscribers/:appUserId` — no JWT, no `ProjectAccessGuard`.
 */
@Controller('v1')
@UseGuards(PublicApiKeyGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post('receipts')
  @HttpCode(200)
  async submitReceipt(@Req() req: RequestWithSdkApp, @Body() body: unknown) {
    const input = parseOrThrow(submitReceiptBodySchema, body);
    const customerInfo = await this.receipts.submitReceipt(req.sdkApp, input, Date.now());
    return { customerInfo };
  }
}
