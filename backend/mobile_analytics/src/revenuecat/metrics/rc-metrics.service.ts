import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/core/projects.service';
import { RcAttributionService } from './rc-attribution.service';
import type { SubscriptionAttributionResponse } from './rc-attribution.service';
import { RcSummaryService } from './rc-summary.service';
import type { SubscriptionsSummaryResponse } from './rc-summary.service';

export type { SubscriptionAttributionResponse } from './rc-attribution.service';
export type { SubscriptionsSummaryResponse } from './rc-summary.service';

/**
 * Facade over `RcSummaryService` (subscriptions summary KPIs) and `RcAttributionService`
 * (conversion drivers/screens/time-to-convert/trial funnel) — see those services for behavior
 * docs. Kept as a thin delegator so `RcMetricsController` has a single injection point.
 *
 * The `summary`/`attribution` constructor params default to plain (non-DI) instances built from
 * `prisma`/`clickhouse`/`projects` so direct construction (e.g. in tests) keeps working with the
 * original 3-arg signature; NestJS DI always resolves and passes all 5 params explicitly via the
 * providers registered in `revenuecat.module.ts`.
 */
@Injectable()
export class RcMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    private readonly summary: RcSummaryService = new RcSummaryService(prisma, clickhouse, projects),
    private readonly attribution: RcAttributionService = new RcAttributionService(
      prisma,
      clickhouse,
      projects,
    ),
  ) {}

  async getSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    filtersRaw?: string,
  ): Promise<SubscriptionsSummaryResponse> {
    return this.summary.getSummary(userId, projectId, fromRaw, toRaw, filtersRaw);
  }

  async getAttribution(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<SubscriptionAttributionResponse> {
    return this.attribution.getAttribution(userId, projectId, fromRaw, toRaw);
  }
}
