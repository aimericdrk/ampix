import { Module } from '@nestjs/common';
import { StoreNotificationJournalService } from './journal/store-notification-journal.service';

/**
 * M1: journal persistence only, no controllers yet (the Apple/Google ingest endpoints are
 * M2/M3). StoreNotificationJournalService is exported so those webhook controllers/processors
 * can journal + replay without re-mounting this module.
 */
@Module({
  providers: [StoreNotificationJournalService],
  exports: [StoreNotificationJournalService],
})
export class WebhooksModule {}
