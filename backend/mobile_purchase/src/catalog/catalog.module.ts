import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { AppsController } from './controllers/apps.controller';
import { EntitlementsController } from './controllers/entitlements.controller';
import { ProductsController } from './controllers/products.controller';
import { OfferingsController } from './controllers/offerings.controller';
import { PublicOfferingsController } from './controllers/public-offerings.controller';
import { AppsService } from './services/apps.service';
import { EntitlementsService } from './services/entitlements.service';
import { ProductsService } from './services/products.service';
import { OfferingsService } from './services/offerings.service';
import { OfferingResolverService } from './services/offering-resolver.service';
import { PublicApiKeyGuard } from './public-api-key.guard';

/**
 * Mounts the catalog domain's controllers. AuthzModule provides ProjectAccessGuard (used by every
 * admin-facing controller below); PrismaModule is @Global() so PrismaService needs no import
 * here. OfferingResolverService is exported so a future purchase-recording flow can resolve the
 * current offering without re-mounting this module. AppsService is exported so M2b's Apple ingest
 * (WebhooksModule) can resolve an App by bundleId without re-mounting this module.
 */
@Module({
  imports: [AuthzModule],
  controllers: [AppsController, EntitlementsController, ProductsController, OfferingsController, PublicOfferingsController],
  providers: [AppsService, EntitlementsService, ProductsService, OfferingsService, OfferingResolverService, PublicApiKeyGuard],
  exports: [OfferingResolverService, AppsService],
})
export class CatalogModule {}
