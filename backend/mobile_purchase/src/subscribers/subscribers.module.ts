import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { SubscribersController } from './controllers/subscribers.controller';
import { EntitlementMapService } from './services/entitlement-map.service';
import { CustomerInfoAssemblerService } from './services/customer-info-assembler.service';

/**
 * M5a: mounts the SDK-facing read endpoint (`GET /v1/subscribers/:appUserId`). Imports
 * CatalogModule for `PublicApiKeyGuard` (the same `publicSdkKey` auth `/v1/offerings` uses) and
 * `AppsService` (to load the App's identifiers for design §3's reserved-id check), and
 * CustomersModule for `CustomersService.getOrCreateCustomer`. `EntitlementMapService` and
 * `CustomerInfoAssemblerService` are exported so M5b's `POST /v1/receipts` can reuse the same
 * CustomerInfo assembly without re-mounting this module.
 */
@Module({
  imports: [CatalogModule, CustomersModule],
  controllers: [SubscribersController],
  providers: [EntitlementMapService, CustomerInfoAssemblerService],
  exports: [EntitlementMapService, CustomerInfoAssemblerService],
})
export class SubscribersModule {}
