import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { ReceiptsController } from './controllers/receipts.controller';
import { ReceiptsService } from './services/receipts.service';

/**
 * M5b: mounts `POST /v1/receipts`, the FINAL core increment of the mobile_purchase server side.
 * Imports CatalogModule (`PublicApiKeyGuard` + `AppsService`), CustomersModule
 * (`getOrCreateCustomer`/`bindStoreToken`), WebhooksModule (the Apple JWS verifier, both stores'
 * `processJournaledNotification` replay entry points, the journal, and the Google `StoreClient` —
 * all exported by `WebhooksModule` specifically for this reuse rather than re-registered here),
 * and SubscribersModule (the SAME `CustomerInfoAssemblerService` M5a's read endpoint uses, per the
 * design principle that `/v1/receipts` returns the identical CustomerInfo shape).
 */
@Module({
  imports: [CatalogModule, CustomersModule, WebhooksModule, SubscribersModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
