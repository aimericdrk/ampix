import { Body, Controller, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '../../common/zod';
import { ProblemException } from '../../common/problem-details';
import { AppleNotificationVerifier, AppleSignatureError, ApplePayloadError } from './apple-notification-verifier';

const appleWebhookBodySchema = z.object({
  // Bounded before any crypto runs: a real ASSN v2 JWS (with nested transaction/renewal JWS) is a
  // few KB; 100 KB is generous headroom while capping a giant-payload DoS at this public,
  // unauthenticated endpoint (belt-and-suspenders with Express's global JSON body limit).
  signedPayload: z.string().min(1, 'signedPayload is required').max(100_000, 'signedPayload too large'),
});

/**
 * Apple App Store Server Notifications V2 ingest (design §1.1/§6): public, store-authenticated —
 * the JWS x5c signature verification IS the auth, no JWT/guard on this route.
 *
 * M2a scope: transport + verify + decode only. `// M2b:` marks the seam where journal-first
 * persistence, App-by-bundleId resolution, and the lifecycle/entitlement pipeline plug in.
 */
@Controller('webhooks/apple')
export class AppleWebhookController {
  private readonly logger = new Logger(AppleWebhookController.name);

  constructor(private readonly verifier: AppleNotificationVerifier) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    const { signedPayload } = parseOrThrow(appleWebhookBodySchema, body);

    try {
      const decoded = await this.verifier.verifyAndDecode(signedPayload);
      // M2b: journal (StoreNotificationJournalService.record, keyed by decoded.notificationUUID)
      // + App-by-bundleId resolution + appleNotificationToEvent + entitlement engine. M2a stops
      // at verify+decode — no persistence yet.
      this.logger.debug(
        `Apple notification verified: ${decoded.notificationType}${decoded.subtype ? `/${decoded.subtype}` : ''} ` +
          `(${decoded.notificationUUID}, bundleId=${decoded.bundleId}) — not yet persisted (M2b)`,
      );
      return { received: true };
    } catch (e) {
      if (e instanceof AppleSignatureError) {
        // design §1.1: verification failures are not real store calls — never journal, 401, no
        // body needed.
        throw new UnauthorizedException();
      }
      if (e instanceof ApplePayloadError) {
        throw new ProblemException({ status: 400, title: 'Bad Request', detail: e.message });
      }
      throw e;
    }
  }
}
