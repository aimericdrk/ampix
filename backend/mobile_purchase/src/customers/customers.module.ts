import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CustomersService } from './services/customers.service';
import { CustomersQueryService } from './services/customers-query.service';
import { CustomerDetailService } from './services/customer-detail.service';
import { CustomersController } from './controllers/customers.controller';
import { EntitlementMapService } from '../subscribers/services/entitlement-map.service';
import { CustomerInfoAssemblerService } from '../subscribers/services/customer-info-assembler.service';

/**
 * M1: persistence (`CustomersService`, exported so M2/M3/M5 can resolve customers without
 * re-mounting this module). B2 (MyRevenueCat Customers design §1.3) additive: mounts the
 * dashboard-facing customers LIST + DETAIL reads, behind AuthzModule's ProjectAccessGuard +
 * @RequireProjectRole('viewer'). `EntitlementMapService`/`CustomerInfoAssemblerService` are
 * provided here as SECOND instances (not imported from SubscribersModule) to avoid a circular
 * module dependency — SubscribersModule already imports CustomersModule for CustomersService.
 * Both are stateless wrappers over the @Global() PrismaService, so a second registered instance
 * costs nothing.
 */
@Module({
  imports: [AuthzModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomersQueryService,
    CustomerDetailService,
    EntitlementMapService,
    CustomerInfoAssemblerService,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
