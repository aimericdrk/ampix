import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { AppsController } from './controllers/apps.controller';
import { EntitlementsController } from './controllers/entitlements.controller';
import { ProductsController } from './controllers/products.controller';
import { OfferingsController } from './controllers/offerings.controller';
import { AppsService } from './services/apps.service';
import { EntitlementsService } from './services/entitlements.service';
import { ProductsService } from './services/products.service';
import { OfferingsService } from './services/offerings.service';
import { OfferingResolverService } from './services/offering-resolver.service';

@Module({
  // AuthModule provides JwtAuthGuard (+ its TokenService dependency, used at the controller level
  // on every catalog controller); AuthzModule provides ProjectRolesGuard. Prisma/Config are
  // @Global(), so neither needs importing here — same pattern as CohortsModule/DashboardsModule/
  // ScreenshotsModule etc.
  imports: [AuthModule, AuthzModule],
  controllers: [AppsController, EntitlementsController, ProductsController, OfferingsController],
  providers: [AppsService, EntitlementsService, ProductsService, OfferingsService, OfferingResolverService],
  exports: [OfferingResolverService],
})
export class CatalogModule {}
