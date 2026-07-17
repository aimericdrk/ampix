import { Body, Controller, Headers, HttpCode, Inject, Logger, Post, Query, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '../../common/zod';
import { ProblemException } from '../../common/problem-details';
import { AppsService } from '../../catalog/services/apps.service';
import type { GooglePushAuthenticator } from './google-push-authenticator';
import { GOOGLE_PUSH_AUTHENTICATOR } from './google-push-auth.factory';
import { GoogleEnvelopeError, decodeDeveloperNotification } from './google-notification-envelope';
import { GoogleIngestService } from './google-ingest.service';

const googlePushBodySchema = z.object({
  message: z.object({
    // Bounded for the same DoS-headroom reason as the Apple controller's signedPayload cap: a
    // real base64-encoded DeveloperNotification is well under a few KB.
    data: z.string().min(1, 'message.data is required').max(100_000, 'message.data too large'),
    messageId: z.string().min(1, 'message.messageId is required'),
    publishTime: z.string().min(1, 'message.publishTime is required'),
  }),
  subscription: z.string().optional(),
});

/**
 * Google Play RTDN over Pub/Sub push ingest (design §1.2/§6): public, store-authenticated — Pub/Sub
 * push auth (shared-secret today, OIDC deferred to X1 — `GooglePushAuthenticator`) IS the auth, no
 * JWT/guard on this route, mirroring `AppleWebhookController`'s shape.
 *
 * M3a: push auth + envelope decode + base64→JSON→`DeveloperNotification` + App-by-packageName
 * resolution. M3b: `GoogleIngestService` — journal-first persistence, the authoritative
 * `StoreClient.getSubscriptionV2`/`getProduct` fetch, and the M4a lifecycle pipeline (the Google
 * analog of `AppleWebhookController` handing off to `AppleIngestService`).
 *
 * Status contract (design §1.2): bad push auth → `401` (no journal — not a real Pub/Sub call);
 * unparseable envelope → `400`; decoded (including a `testNotification`) → `200`, always, once
 * auth + decode succeed — the same "journal-first, so 200 as soon as we have something to journal"
 * contract Apple uses. `GoogleIngestService` never throws (any processing failure is caught and
 * journaled FAILED, replayable — design §1.2/§7), so this controller relies on that to keep the
 * 200 contract regardless of what happens downstream of a successful decode.
 */
@Controller('webhooks/google')
export class GoogleWebhookController {
  private readonly logger = new Logger(GoogleWebhookController.name);

  constructor(
    @Inject(GOOGLE_PUSH_AUTHENTICATOR) private readonly authenticator: GooglePushAuthenticator,
    private readonly apps: AppsService,
    private readonly ingest: GoogleIngestService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: unknown,
    @Query('token') token: string | undefined,
    @Headers('authorization') authorizationHeader: string | undefined,
  ): Promise<{ received: true }> {
    // The authenticator contract is "returning false OR throwing must yield 401." The real OIDC
    // verifier (X1) can throw on a JWKS fetch/parse failure — treat any throw as auth failure so it
    // becomes a 401, never an uncaught 500 that leaks as a different signal.
    let authenticated = false;
    try {
      authenticated = await this.authenticator.authenticate({ queryToken: token, authorizationHeader });
    } catch {
      authenticated = false;
    }
    if (!authenticated) {
      // design §1.2: bad/missing push auth is not a real, trusted Pub/Sub call — never journal.
      throw new UnauthorizedException();
    }

    const { message } = parseOrThrow(googlePushBodySchema, body);

    let notification;
    try {
      notification = decodeDeveloperNotification(message.data);
    } catch (e) {
      if (e instanceof GoogleEnvelopeError) {
        throw new ProblemException({ status: 400, title: 'Bad Request', detail: e.message });
      }
      throw e;
    }

    // design §1.2 App mapping: App.findFirst({ platform: ANDROID, packageName }).
    const app = await this.apps.findByPackageName(notification.packageName);
    if (!app) {
      this.logger.debug(
        `Google RTDN for unknown packageName "${notification.packageName}" (messageId ${message.messageId}) — journaling SKIPPED`,
      );
    }

    // M3b: journal-first persistence, StoreClient.getSubscriptionV2()/getProduct() authoritative
    // fetch, and the M4a googleNotificationToEvent lifecycle pipeline — mirrors
    // AppleIngestService.handleVerifiedAppleNotification / processJournaledNotification. Never
    // throws (see class docstring), so the 200 below is always reached once we get this far.
    await this.ingest.handleDeveloperNotification(notification, app, message.messageId);

    return { received: true };
  }
}
