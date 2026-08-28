import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import {
  AiRequestError,
  AiUnconfiguredError,
  MistralService,
} from '../../analytics/ai/mistral.service';
import { ProblemException } from '../../common/problem-details';
import { RcJourneyService } from './rc-journey.service';
import type { JourneyAnalysisResponse, JourneyOutcome, JourneyResponse } from './journey.types';

/** The model's reply. Validated before it can reach a response body — same rule as `/query/ask`:
 *  nothing a language model returns is trusted on the strength of the prompt alone. */
const analysisSchema = z.object({
  headline: z.string().min(1).max(500),
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        detail: z.string().min(1).max(2000),
        evidence: z.array(z.string().max(500)).max(10).default([]),
      }),
    )
    .max(10)
    .default([]),
  caveats: z.array(z.string().max(1000)).max(10).default([]),
});

function badRequest(detail: string): ProblemException {
  return new ProblemException({ status: 400, title: 'Bad Request', detail });
}

function parseOutcome(raw: string | undefined): JourneyOutcome {
  if (raw === undefined || raw === 'subscribe') return 'subscribe';
  if (raw === 'refund') return 'refund';
  throw badRequest("outcome: must be 'subscribe' or 'refund'");
}

/** Rejects a malformed value rather than silently falling back, matching `read-query.util`'s rule
 *  for every param except `limit`. The service clamps the range; this only guards the parse. */
function parseCount(raw: string | undefined, paramName: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw badRequest(`${paramName}: must be a positive integer`);
  }
  return value;
}

/**
 * The subscription-journey endpoints (MyRevenueCat → Journey).
 *
 * `GET .../journey` is written to be fetched by a language model as much as by the dashboard: the
 * payload states its own units, cohort definitions and sample sizes, so an agent holding a bearer
 * token can pull it and reason about it with no other context. `POST .../journey/analyze` is the
 * in-product path to the same thing — it recomputes the identical report, hands it to Mistral, and
 * returns the findings WITH the report they were drawn from so the narrative stays auditable.
 */
@Controller('api/v1/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class RcJourneyController {
  constructor(
    private readonly journey: RcJourneyService,
    private readonly mistral: MistralService,
  ) {}

  @Get('metrics/subscriptions/journey')
  async subscriptionJourney(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('outcome') outcome?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('window_days') windowDays?: string,
    @Query('path_steps') pathSteps?: string,
  ): Promise<JourneyResponse> {
    return this.journey.getJourney(
      req.user!.id,
      projectId,
      parseOutcome(outcome),
      from,
      to,
      parseCount(windowDays, 'window_days'),
      parseCount(pathSteps, 'path_steps'),
    );
  }

  @Post('metrics/subscriptions/journey/analyze')
  // 200, not 201: this creates nothing, it reads a report and returns an opinion about it.
  @HttpCode(200)
  async analyzeSubscriptionJourney(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Query('outcome') outcome?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('window_days') windowDays?: string,
    @Query('path_steps') pathSteps?: string,
  ): Promise<JourneyAnalysisResponse> {
    const parsedOutcome = parseOutcome(outcome);
    const report = await this.journey.getJourney(
      req.user!.id,
      projectId,
      parsedOutcome,
      from,
      to,
      parseCount(windowDays, 'window_days'),
      parseCount(pathSteps, 'path_steps'),
    );

    let raw: unknown;
    try {
      raw = await this.mistral.analyzeJourney(report);
    } catch (err) {
      if (err instanceof AiUnconfiguredError) {
        throw new ProblemException({
          status: 503,
          title: 'Service Unavailable',
          detail: 'AI analysis is not configured',
        });
      }
      if (err instanceof AiRequestError) {
        throw new ProblemException({
          status: 502,
          title: 'Bad Gateway',
          detail: 'The AI provider could not be reached',
        });
      }
      throw err;
    }

    const parsed = analysisSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProblemException({
        status: 422,
        title: 'Unprocessable Entity',
        detail: 'The AI returned an analysis in an unexpected shape',
      });
    }

    return { outcome: parsedOutcome, ...parsed.data, report };
  }
}
