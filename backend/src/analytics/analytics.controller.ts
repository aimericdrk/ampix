import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '../auth/auth.schemas';
import type { AuthRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProblemException } from '../common/problem-details';
import { AiRequestError, AiUnconfiguredError, MistralService } from './ai/mistral.service';
import { AnalyticsService } from './analytics.service';
import type {
  AskResponse,
  EventsMetaResponse,
  InsightsResponse,
  LiveEventsResponse,
  PropertiesMetaResponse,
  PropertyValuesResponse,
  RevenueSummaryResponse,
  SessionsSummaryResponse,
  UserProfileResponse,
  UsersResponse,
} from './analytics.types';
import { insightsQuerySchema } from './insights-query.schema';

/** feat-17 §3.1 — `POST /query/ask` body: a short free-text question (1..500 chars). */
const askQuestionSchema = z.object({
  question: z.string().trim().min(1).max(500),
});

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
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly mistral: MistralService,
  ) {}

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

  @Get('meta/property-values')
  async metaPropertyValues(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('property') property?: string,
    @Query('event') event?: string,
    @Query('limit') limit?: string,
  ): Promise<PropertyValuesResponse> {
    return this.analytics.listPropertyValues(req.user!.id, projectId, property, event, limit);
  }

  @Get('events/live')
  async eventsLive(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<LiveEventsResponse> {
    return this.analytics.getLiveEvents(req.user!.id, projectId, limit, before);
  }

  @Get('users')
  async users(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<UsersResponse> {
    return this.analytics.listUsers(req.user!.id, projectId, search, limit, cursor);
  }

  @Get('users/:distinctId')
  async userProfile(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ): Promise<UserProfileResponse> {
    return this.analytics.getUserProfile(req.user!.id, projectId, distinctId);
  }

  @Get('sessions/summary')
  async sessionsSummary(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filters') filters?: string,
  ): Promise<SessionsSummaryResponse> {
    return this.analytics.getSessionsSummary(req.user!.id, projectId, from, to, filters);
  }

  @Get('metrics/revenue')
  async revenueSummary(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filters') filters?: string,
  ): Promise<RevenueSummaryResponse> {
    return this.analytics.getRevenueSummary(req.user!.id, projectId, from, to, filters);
  }

  /**
   * feat-17 §3.1 — "Ask your data": translates a natural-language question into a validated
   * Insights query definition via Mistral. `listEventNames`/`listProperties` double as this
   * route's membership check (both assert project membership internally) while also supplying the
   * model's only allowed event/property names. The model's raw JSON output is NEVER trusted or
   * executed — it is validated against the exact same `insightsQuerySchema` `/query/insights` uses
   * before it is returned, so it can only ever become a normal, safe Insights query.
   */
  @Post('query/ask')
  @HttpCode(200) // a query, not a resource creation — Nest defaults POST to 201 without this
  async ask(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<AskResponse> {
    const { question } = parseOrThrow(askQuestionSchema, body);
    const userId = req.user!.id;

    const [eventsMeta, propertiesMeta] = await Promise.all([
      this.analytics.listEventNames(userId, projectId),
      this.analytics.listProperties(userId, projectId),
    ]);

    let raw: unknown;
    try {
      raw = await this.mistral.translateToInsights(question, {
        events: eventsMeta.events,
        properties: propertiesMeta.properties.map((property) => property.name),
      });
    } catch (err) {
      if (err instanceof AiUnconfiguredError) {
        throw new ProblemException({ status: 503, title: 'AI query is not configured' });
      }
      if (err instanceof AiRequestError) {
        throw new ProblemException({
          status: 502,
          title: 'AI query failed',
          detail: err.message,
        });
      }
      throw err;
    }

    let definition;
    try {
      definition = parseOrThrow(insightsQuerySchema, raw);
    } catch (err) {
      if (err instanceof ProblemException) {
        throw new ProblemException({
          status: 422,
          title: 'Could not turn that into a query',
          detail: err.problem.detail,
        });
      }
      throw err;
    }

    return { question, definition };
  }
}
