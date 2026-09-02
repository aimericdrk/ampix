import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { ProblemException } from '../../common/problem-details';
import type { ErasureResult } from '../../erasure/erasure.service';
import { AiRequestError, AiUnconfiguredError, MistralService } from '../ai/mistral.service';
import { AnalyticsService } from '../services/analytics.service';
import { UserAdminService } from '../services/user-admin.service';
import { AttributionService } from '../queries/attribution/attribution.service';
import type { AttributionResponse } from '../queries/attribution/attribution.types';
import { ExperimentsService } from '../queries/experiments/experiments.service';
import type { ExperimentResponse } from '../queries/experiments/experiment.types';
import type {
  AskResponse,
  DeletedEventResponse,
  EventsMetaResponse,
  HiddenUsersResponse,
  InsightsResponse,
  LiveEventsResponse,
  PropertiesMetaResponse,
  PropertyValuesResponse,
  RevenueSummaryResponse,
  SessionsSummaryResponse,
  UserEventsResponse,
  UserProfileResponse,
  UsersResponse,
} from '../analytics.types';
import { insightsQuerySchema } from '../queries/insights/insights-query.schema';

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
    private readonly userAdmin: UserAdminService,
    private readonly attribution: AttributionService,
    private readonly experiments: ExperimentsService,
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
    @Query('source') source?: string,
  ): Promise<LiveEventsResponse> {
    return this.analytics.getLiveEvents(req.user!.id, projectId, limit, before, source);
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

  /**
   * Declared BEFORE `users/:distinctId` on purpose: Nest matches routes in declaration order, so a
   * later position would let the `:distinctId` param route swallow `/users/hidden` and answer it
   * with the profile of a user literally named "hidden".
   */
  @Get('users/hidden')
  async hiddenUsers(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
  ): Promise<HiddenUsersResponse> {
    return this.userAdmin.listHiddenUsers(req.user!.id, projectId);
  }

  @Get('users/:distinctId')
  async userProfile(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ): Promise<UserProfileResponse> {
    return this.analytics.getUserProfile(req.user!.id, projectId, distinctId);
  }

  /**
   * The profile timeline's "load more": page `before` the composite cursor the previous page
   * returned. Both cursor halves travel together — see UsersService.getUserEvents.
   */
  @Get('users/:distinctId/events')
  async userEvents(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
    @Query('before') before?: string,
    @Query('before_id') beforeId?: string,
  ): Promise<UserEventsResponse> {
    return this.analytics.getUserEvents(req.user!.id, projectId, distinctId, before, beforeId);
  }

  /**
   * Delete ONE event out of a user's history — the smallest destructive action on this surface, and
   * the one an operator reaches for after a test purchase or a debug-build event lands in real
   * data. Irreversible like the erase, and it does move the numbers: the row leaves `events`, so
   * every insight, funnel and revenue figure computed from it changes.
   *
   * admin+ for the same reason the erase is: it silently rewrites history for everyone else
   * looking at the project.
   */
  @Delete('users/:distinctId/events/:insertId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(200)
  async deleteUserEvent(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
    @Param('insertId') insertId: string,
  ): Promise<DeletedEventResponse> {
    return this.userAdmin.deleteUserEvent(req.user!.id, projectId, distinctId, insertId);
  }

  /**
   * Hide a user from the audience surfaces (§17 soft remove) — REVERSIBLE, and the safe half of the
   * dashboard's delete action. Their events stay on disk and keep counting in every chart; they
   * simply stop appearing in the Users list, the live feed and the attribution readout.
   *
   * admin+ like the other destructive-adjacent project mutations (token revocation, data purge):
   * hiding is reversible, but a user vanishing from the audience list without explanation is
   * confusing enough that it should not be every analyst's to do.
   */
  @Post('users/:distinctId/hide')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(200)
  async hideUser(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ): Promise<{ distinct_id: string }> {
    return this.userAdmin.hideUser(req.user!.id, projectId, distinctId);
  }

  /** Un-hide: put a hidden user back into the audience surfaces. Idempotent. */
  @Delete('users/:distinctId/hide')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(204)
  async unhideUser(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ): Promise<void> {
    await this.userAdmin.unhideUser(req.user!.id, projectId, distinctId);
  }

  /**
   * Erase a user — IRREVERSIBLE. The dashboard-authenticated twin of the server-token GDPR route
   * (`DELETE /ingest/users/:distinctId`), running the exact same ErasureService so the two can
   * never drift: every event, profile row and identity mapping in ClickHouse plus the RevenueCat
   * mirrors in Postgres, for this user and every id linked to them.
   *
   * Returns what was actually removed (`ids`, plus the Postgres row counts) rather than a bare 204,
   * so the confirmation the operator sees is the server's account of the deletion, not the client's
   * assumption about it.
   */
  @Delete('users/:distinctId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(200)
  async eraseUser(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ): Promise<ErasureResult> {
    return this.userAdmin.eraseUser(req.user!.id, projectId, distinctId);
  }

  /**
   * Where the accounts created in a window came from — installs and identified signups side by
   * side per first-touch source/campaign/medium/referrer, plus the accounts themselves. A read, so
   * viewer+ with membership enforced in the service, like the rest of this controller.
   */
  @Get('metrics/attribution')
  async attributionMetrics(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AttributionResponse> {
    return this.attribution.getAttribution(req.user!.id, projectId, from, to);
  }

  /** The A/B-test readout: per-variant conversion plus significance. See ExperimentsService. */
  @Post('query/experiment')
  @HttpCode(200) // a query, not a resource creation
  async experiment(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<ExperimentResponse> {
    return this.experiments.runExperimentQuery(req.user!.id, projectId, body);
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
