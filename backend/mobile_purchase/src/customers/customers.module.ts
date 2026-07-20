import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CustomersService } from './services/customers.service';
import { CustomersQueryService } from './services/customers-query.service';
import { CustomersController } from './controllers/customers.controller';

/**
 * M1: persistence (`CustomersService`, exported so M2/M3/M5 can resolve customers without
 * re-mounting this module). B2.1 (MyRevenueCat Customers design §1.3) additive: mounts the
 * dashboard-facing customers LIST read (`GET /api/v1/projects/:projectId/customers`), behind
 * AuthzModule's ProjectAccessGuard + @RequireProjectRole('viewer').
 */
@Module({
  imports: [AuthzModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersQueryService],
  exports: [CustomersService],
})
export class CustomersModule {}
