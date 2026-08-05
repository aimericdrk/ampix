import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { PublicApiKeyGuard, type RequestWithSdkApp } from '../../catalog/public-api-key.guard';
import { AppsService } from '../../catalog/services/apps.service';
import { CustomersService } from '../../customers/services/customers.service';
import { appReservedStoreIds } from '../support/reserved-store-ids';
import { CustomerInfoAssemblerService } from '../services/customer-info-assembler.service';

/**
 * PUBLIC, key-authenticated surface — what flutter_purchases calls to fetch a subscriber's
 * CustomerInfo (design §5's `GET /v1/subscribers/:appUserId`). Authenticated by
 * `PublicApiKeyGuard` (`App.publicSdkKey`), exactly like `/v1/offerings` — no JWT, no
 * `ProjectAccessGuard`. An unknown-but-valid `:appUserId` resolves-or-creates the Customer and
 * returns an EMPTY CustomerInfo — RevenueCat never 404s a subscriber-info read.
 */
@Controller('v1')
@UseGuards(PublicApiKeyGuard)
export class SubscribersController {
  constructor(
    private readonly appsService: AppsService,
    private readonly customersService: CustomersService,
    private readonly assembler: CustomerInfoAssemblerService,
  ) {}

  @Get('subscribers/:appUserId')
  async getSubscriber(@Req() req: RequestWithSdkApp, @Param('appUserId') appUserId: string) {
    const app = await this.appsService.findIdentifiers(req.sdkApp.id);
    const reservedStoreIds = appReservedStoreIds(app);

    // Reserved/invalid app_user_id -> 400 (assertValidAppUserId, via getOrCreateCustomer),
    // before any Customer row is created. Unknown-but-valid -> resolve-or-create (design §5).
    const customer = await this.customersService.getOrCreateCustomer(
      req.sdkApp.projectId,
      appUserId,
      reservedStoreIds,
    );

    // computeCustomerInfo (M4b) is pure and takes `nowMs` — the impurity lives here, at the
    // controller boundary, exactly once per request.
    const customerInfo = await this.assembler.assemble(
      { projectId: req.sdkApp.projectId, appId: req.sdkApp.id, customer },
      Date.now(),
    );

    return { customerInfo };
  }
}
