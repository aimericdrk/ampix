import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { PrismaService } from '../prisma/prisma.service';
import { StoreNotificationJournalService } from './journal/store-notification-journal.service';
import { AppleWebhookController } from './apple/apple-webhook.controller';
import { AppleNotificationVerifier, APPLE_SIGNED_DATA_VERIFIERS } from './apple/apple-notification-verifier';
import { buildAppleSignedDataVerifiers } from './apple/apple-verifier.factory';
import { AppleIngestService } from './apple/apple-ingest.service';
import { GoogleWebhookController } from './google/google-webhook.controller';
import { GOOGLE_PUSH_AUTHENTICATOR, buildGooglePushAuthenticator } from './google/google-push-auth.factory';
import { GOOGLE_STORE_CLIENT, buildGoogleStoreClient } from './google/google-store-client.factory';
import { GoogleIngestService } from './google/google-ingest.service';

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
 * App-by-packageName resolution (via CatalogModule's exported AppsService).
 * M3b: `GoogleIngestService` — the Google analog of `AppleIngestService`: journal-first
 * persistence, the authoritative `StoreClient.getSubscriptionV2`/`getProduct` fetch (via the
 * creds-gated `GoogleApiStoreClient` — real Google ingest stays blocked until a connect-store flow
 * populates `App.storeCredentials`, design §1.2/§8), and the M4a lifecycle pipeline. Both
 * `AppleIngestService` and `GoogleIngestService` share their store-agnostic persistence core
 * (`src/webhooks/shared/persist-lifecycle-event.ts`).
 */
@Module({
  imports: [CatalogModule, CustomersModule],
  controllers: [AppleWebhookController, GoogleWebhookController],
  providers: [
    StoreNotificationJournalService,
    AppleNotificationVerifier,
    AppleIngestService,
    GoogleIngestService,
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
    {
      provide: GOOGLE_STORE_CLIENT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => buildGoogleStoreClient(prisma),
    },
  ],
  exports: [StoreNotificationJournalService],
})
export class WebhooksModule {}
