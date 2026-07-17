import { Module } from '@nestjs/common';
import { CustomersService } from './services/customers.service';

/**
 * M1: persistence only, no controllers yet (the SDK-facing read/receipt endpoints are M5).
 * CustomersService is exported so M2 (Apple)/M3 (Google)/M5 (SDK API) can resolve customers
 * without re-mounting this module.
 */
@Module({
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
