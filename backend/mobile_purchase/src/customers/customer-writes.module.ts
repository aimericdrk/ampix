import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
import { CustomerDeletionController } from './controllers/customer-deletion.controller';
import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';
import { CustomerDeletionService } from './services/customer-deletion.service';

/**
 * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
 * (B3.1/B3.2) and customer deletion (this task). Deliberately separate from `CustomersModule`
 * (M1 ingest persistence) and the read-side customers controller (B2) — no route collision,
 * since every controller here owns a distinct HTTP method + path under
 * `api/v1/projects/:projectId/customers`.
 */
@Module({
  imports: [AuthzModule],
  controllers: [PromotionalEntitlementsController, CustomerDeletionController],
  providers: [PromotionalEntitlementsService, CustomerDeletionService],
})
export class CustomerWritesModule {}
