import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';

/**
 * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
 * (this task) and customer deletion (`CustomerDeletionController`/`CustomerDeletionService`,
 * added by B3.3 to this same module). Deliberately separate from `CustomersModule` (M1 ingest
 * persistence) and the read-side customers controller (B2) — no route collision, since every
 * controller here owns a distinct HTTP method + path under
 * `api/v1/projects/:projectId/customers`.
 */
@Module({
  imports: [AuthzModule],
  controllers: [PromotionalEntitlementsController],
  providers: [PromotionalEntitlementsService],
})
export class CustomerWritesModule {}
