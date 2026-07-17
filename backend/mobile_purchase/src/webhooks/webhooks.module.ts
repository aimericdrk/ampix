import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { StoreNotificationJournalService } from './journal/store-notification-journal.service';
import { AppleWebhookController } from './apple/apple-webhook.controller';
import { AppleNotificationVerifier, APPLE_SIGNED_DATA_VERIFIERS } from './apple/apple-notification-verifier';
import { buildAppleSignedDataVerifiers } from './apple/apple-verifier.factory';

/**
 * M1: journal persistence primitives (StoreNotificationJournalService, exported so M2b's
 * verify -> decode -> journal -> handle flow can use it without re-mounting this module).
 * M2a: mounts the Apple ASSN v2 ingest endpoint (`POST /webhooks/apple`) — transport + JWS
 * verify + decode only, no journaling/persistence yet (that lands in M2b, consuming the same
 * AppleNotificationVerifier this module already provides). Google (M3) will follow the same
 * shape under `webhooks/google/`.
 */
@Module({
  controllers: [AppleWebhookController],
  providers: [
    StoreNotificationJournalService,
    AppleNotificationVerifier,
    {
      provide: APPLE_SIGNED_DATA_VERIFIERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildAppleSignedDataVerifiers(config),
    },
  ],
  exports: [StoreNotificationJournalService],
})
export class WebhooksModule {}
