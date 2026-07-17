import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { StoreNotificationJournalService } from './journal/store-notification-journal.service';
import { AppleWebhookController } from './apple/apple-webhook.controller';
import { AppleNotificationVerifier, APPLE_SIGNED_DATA_VERIFIERS } from './apple/apple-notification-verifier';
import { buildAppleSignedDataVerifiers } from './apple/apple-verifier.factory';
import { AppleIngestService } from './apple/apple-ingest.service';

/**
 * M1: journal persistence primitives (StoreNotificationJournalService, exported so M2b's
 * verify -> decode -> journal -> handle flow can use it without re-mounting this module).
 * M2a: mounts the Apple ASSN v2 ingest endpoint (`POST /webhooks/apple`) — transport + JWS
 * verify + decode.
 * M2b: `AppleIngestService` — journal-first persistence, App-by-bundleId resolution (via
 * CatalogModule's exported AppsService), Customer self-attribution (via CustomersModule's
 * exported CustomersService), and the M4a lifecycle pipeline. Google (M3) will follow the same
 * shape under `webhooks/google/`.
 */
@Module({
  imports: [CatalogModule, CustomersModule],
  controllers: [AppleWebhookController],
  providers: [
    StoreNotificationJournalService,
    AppleNotificationVerifier,
    AppleIngestService,
    {
      provide: APPLE_SIGNED_DATA_VERIFIERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildAppleSignedDataVerifiers(config),
    },
  ],
  exports: [StoreNotificationJournalService],
})
export class WebhooksModule {}
