import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '../../common/zod';
import { ProblemException } from '../../common/problem-details';
import { AppleNotificationVerifier, AppleSignatureError, ApplePayloadError } from './apple-notification-verifier';
import { AppleIngestService } from './apple-ingest.service';

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
 * M2a verifies+decodes; M2b (`AppleIngestService`) does the journal-first persistence,
 * App-by-bundleId resolution, and lifecycle/entitlement pipeline. `AppleIngestService` never
 * throws for a processing failure (it journals FAILED and returns) — the only errors this
 * controller ever sees are verification/payload-shape failures from the verifier itself, so the
 * 200 status contract (design §1.1: "a verified notification is always 200 once journaled") holds
 * without this controller needing to special-case ingest failures.
 */
@Controller('webhooks/apple')
export class AppleWebhookController {
  constructor(
    private readonly verifier: AppleNotificationVerifier,
    private readonly ingest: AppleIngestService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    const { signedPayload } = parseOrThrow(appleWebhookBodySchema, body);

    try {
      const decoded = await this.verifier.verifyAndDecode(signedPayload);
      await this.ingest.handleVerifiedAppleNotification(decoded);
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
