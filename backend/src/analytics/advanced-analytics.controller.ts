import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdvancedAnalyticsService } from './advanced-analytics.service';
import type { FlowResponse, FunnelResponse, RetentionResponse } from './analytics.types';

/**
 * Advanced analysis endpoints (contracts §15): funnels, retention, user flows. Same surface as the
 * §14 {@link AnalyticsController} — mounted under `/api/v1/projects/:projectId`, JWT-guarded, with
 * project membership (viewer+) enforced inside the service. Kept as a separate controller so the
 * Phase-3 controller stays focused; both register on the same base path.
 */
@Controller('api/v1/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class AdvancedAnalyticsController {
  constructor(private readonly advanced: AdvancedAnalyticsService) {}

  @Post('query/funnels')
  @HttpCode(200) // a query, not a resource creation — Nest defaults POST to 201 without this
  async funnels(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<FunnelResponse> {
    return this.advanced.runFunnelQuery(req.user!.id, projectId, body);
  }

  @Post('query/retention')
  @HttpCode(200)
  async retention(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<RetentionResponse> {
    return this.advanced.runRetentionQuery(req.user!.id, projectId, body);
  }

  @Post('query/flows')
  @HttpCode(200)
  async flows(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<FlowResponse> {
    return this.advanced.runFlowQuery(req.user!.id, projectId, body);
  }
}
