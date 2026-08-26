import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ErasureKeyGuard } from '../common/erasure-key.guard';
import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
import { CustomerDeletionController } from './controllers/customer-deletion.controller';
import { SubscriberDeletionController } from './controllers/subscriber-deletion.controller';
import { RefundController } from './controllers/refund.controller';
import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';
import { CustomerDeletionService } from './services/customer-deletion.service';
import { RefundService } from './services/refund.service';

/**
 * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
 * (B3.1/B3.2), customer deletion, and the D1 Google Play refund action. Deliberately separate
 * from `CustomersModule` (M1 ingest persistence) and the read-side customers controller (B2) —
 * no route collision, since every controller here owns a distinct HTTP method + path under
 * `api/v1/projects/:projectId/customers`. WebhooksModule is imported for its exported
 * `GOOGLE_STORE_CLIENT` (the same creds-gated `GoogleApiStoreClient` instance ReceiptsModule
 * reuses — D1 design §1.4: no second, divergent store client).
 */
@Module({
  // CatalogModule is imported for its exported PublicApiKeyGuard — the SDK-key auth the
  // subscriber-erasure route shares with /v1/offerings and /v1/subscribers reads.
  imports: [AuthzModule, WebhooksModule, CatalogModule],
  controllers: [
    PromotionalEntitlementsController,
    CustomerDeletionController,
    SubscriberDeletionController,
    RefundController,
  ],
  providers: [PromotionalEntitlementsService, CustomerDeletionService, RefundService, ErasureKeyGuard],
})
export class CustomerWritesModule {}
