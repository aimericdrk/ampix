import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import type {
  EventsMetaResponse,
  InsightsResponse,
  PropertiesMetaResponse,
} from './analytics.types';

/**
 * Core analytics query engine (contracts §14): read-only endpoints over `analytics.events`.
 * Gated by JwtAuthGuard + project membership (any role) — the membership check happens inside
 * AnalyticsService (reusing ProjectsService.assertMembership), matching the existing
 * `GET :projectId/events/summary` pattern rather than the RolesGuard/@Roles matrix (which is for
 * role-gated *mutations*; every route here is a read available to viewer+, i.e. any member).
 */
@Controller('api/v1/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('query/insights')
  @HttpCode(200) // a query, not a resource creation — Nest defaults POST to 201 without this
  async insights(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<InsightsResponse> {
    return this.analytics.runInsightsQuery(req.user!.id, projectId, body);
  }

  @Get('meta/events')
  async metaEvents(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
  ): Promise<EventsMetaResponse> {
    return this.analytics.listEventNames(req.user!.id, projectId);
  }

  @Get('meta/properties')
  async metaProperties(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('event') event?: string,
  ): Promise<PropertiesMetaResponse> {
    return this.analytics.listProperties(req.user!.id, projectId, event);
  }
}
