import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import type {
  ClickHeatmapResponse,
  EngagementResponse,
  FlowResponse,
  HistogramResponse,
  TapElementsResponse,
} from '../analytics.types';
import { V2AnalyticsService } from '../services/v2-analytics.service';

/**
 * v2 analytics endpoints (contracts §19): click-heatmap, histogram, screen-paths, engagement. Same
 * surface as the §14/§15 controllers — mounted under `/api/v1/projects/:projectId`, JWT-guarded,
 * with project membership (viewer+) enforced inside the service (matching the §14 read pattern, not
 * the RolesGuard matrix which gates mutations).
 */
@Controller('api/v1/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class V2AnalyticsController {
  constructor(private readonly v2: V2AnalyticsService) {}

  @Post('query/click-heatmap')
  @HttpCode(200) // a query, not a resource creation
  async clickHeatmap(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<ClickHeatmapResponse> {
    return this.v2.runClickHeatmap(req.user!.id, projectId, body);
  }

  /**
   * The heatmap's companion: what was tapped, ranked. Correct on screens taller than the viewport,
   * where a tap's position cannot be placed against a reference screenshot.
   */
  @Post('query/tap-elements')
  @HttpCode(200) // a query, not a resource creation
  async tapElements(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<TapElementsResponse> {
    return this.v2.runTapElements(req.user!.id, projectId, body);
  }

  @Post('query/histogram')
  @HttpCode(200) // a query, not a resource creation
  async histogram(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<HistogramResponse> {
    return this.v2.runHistogram(req.user!.id, projectId, body);
  }

  @Post('query/screen-paths')
  @HttpCode(200)
  async screenPaths(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<FlowResponse> {
    return this.v2.runScreenPaths(req.user!.id, projectId, body);
  }

  @Get('metrics/engagement')
  async engagement(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('interval') interval?: string,
    @Query('filters') filters?: string,
  ): Promise<EngagementResponse> {
    return this.v2.getEngagement(req.user!.id, projectId, from, to, interval, filters);
  }
}
