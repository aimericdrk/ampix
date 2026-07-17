import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PublicApiKeyGuard, type RequestWithSdkApp } from '../public-api-key.guard';
import { OfferingResolverService } from '../services/offering-resolver.service';

/**
 * PUBLIC, key-authenticated surface — what flutter_purchases calls to fetch the current
 * offering. Authenticated by PublicApiKeyGuard (App.publicSdkKey), not the dashboard's JWT.
 */
@Controller('v1')
@UseGuards(PublicApiKeyGuard)
export class PublicOfferingsController {
  constructor(private readonly resolver: OfferingResolverService) {}

  @Get('offerings')
  async getOfferings(@Req() req: RequestWithSdkApp) {
    const current = await this.resolver.resolveCurrentOffering(req.sdkApp.projectId);
    return { current };
  }
}
