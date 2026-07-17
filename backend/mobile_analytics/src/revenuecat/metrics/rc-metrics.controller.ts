import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { RcMetricsService } from './rc-metrics.service';
import type { SubscriptionAttributionResponse, SubscriptionsSummaryResponse } from './rc-metrics.service';

/**
 * Subscriptions page data (spec §4.7 amendment). Mirrors `AnalyticsController.revenueSummary`:
 * JWT + `assertMembership` (any role) — `RcMetricsService.getSummary` does the membership check.
 */
@Controller('api/v1/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class RcMetricsController {
  constructor(private readonly rcMetrics: RcMetricsService) {}

  @Get('metrics/subscriptions')
  async subscriptionsSummary(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filters') filters?: string,
  ): Promise<SubscriptionsSummaryResponse> {
    return this.rcMetrics.getSummary(req.user!.id, projectId, from, to, filters);
  }

  @Get('metrics/subscriptions/attribution')
  async subscriptionsAttribution(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<SubscriptionAttributionResponse> {
    return this.rcMetrics.getAttribution(req.user!.id, projectId, from, to);
  }
}
