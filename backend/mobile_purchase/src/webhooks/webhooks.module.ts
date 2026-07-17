import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { StoreNotificationJournalService } from './journal/store-notification-journal.service';
import { AppleWebhookController } from './apple/apple-webhook.controller';
import { AppleNotificationVerifier, APPLE_SIGNED_DATA_VERIFIERS } from './apple/apple-notification-verifier';
import { buildAppleSignedDataVerifiers } from './apple/apple-verifier.factory';
import { AppleIngestService } from './apple/apple-ingest.service';
import { GoogleWebhookController } from './google/google-webhook.controller';
import { GOOGLE_PUSH_AUTHENTICATOR, buildGooglePushAuthenticator } from './google/google-push-auth.factory';

/**
 * M1: journal persistence primitives (StoreNotificationJournalService, exported so M2b's
 * verify -> decode -> journal -> handle flow can use it without re-mounting this module).
 * M2a: mounts the Apple ASSN v2 ingest endpoint (`POST /webhooks/apple`) — transport + JWS
 * verify + decode.
 * M2b: `AppleIngestService` — journal-first persistence, App-by-bundleId resolution (via
 * CatalogModule's exported AppsService), Customer self-attribution (via CustomersModule's
 * exported CustomersService), and the M4a lifecycle pipeline.
 * M3a: mounts the Google RTDN ingest endpoint (`POST /webhooks/google`) — Pub/Sub push auth
 * (`GooglePushAuthenticator`, shared-secret today / OIDC deferred to X1) + envelope decode +
 * App-by-packageName resolution (via CatalogModule's exported AppsService). M3b (not built here)
 * adds the Google analog of `AppleIngestService`: journal-first persistence, the authoritative
 * `StoreClient` fetch, and the M4a lifecycle pipeline.
 */
@Module({
  imports: [CatalogModule, CustomersModule],
  controllers: [AppleWebhookController, GoogleWebhookController],
  providers: [
    StoreNotificationJournalService,
    AppleNotificationVerifier,
    AppleIngestService,
    {
      provide: APPLE_SIGNED_DATA_VERIFIERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildAppleSignedDataVerifiers(config),
    },
    {
      provide: GOOGLE_PUSH_AUTHENTICATOR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildGooglePushAuthenticator(config),
    },
  ],
  exports: [StoreNotificationJournalService],
})
export class WebhooksModule {}
