import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { CohortsService } from '../../cohorts/cohorts.service';
import { ProjectsService } from '../../projects/core/projects.service';
import type {
  EventsMetaResponse,
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
import { InsightsQueryService } from './insights-query.service';
import { MetadataService } from './metadata.service';
import { SummariesService } from './summaries.service';
import { UsersService } from './users.service';
import { NO_HIDDEN_USERS } from './analytics.shared';

/**
 * Facade over `InsightsQueryService`, `MetadataService`, `UsersService`, and `SummariesService`
 * (contracts §14/§17/§19) — see those services for behavior docs. Kept as a thin delegator so
 * `AnalyticsController` (and the §16 saved-reports/dashboards runner) have a single injection
 * point, matching the precedent set by `RcMetricsService`.
 *
 * The 4 sub-service constructor params default to plain (non-DI) instances built from
 * `clickhouse`/`projects`/`cohorts` so direct construction (e.g. in tests) keeps working with the
 * original 3-arg signature; NestJS DI always resolves and passes all 7 params explicitly via the
 * providers registered in `analytics.module.ts`.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    private readonly cohorts: CohortsService,
    private readonly metadata: MetadataService = new MetadataService(clickhouse, projects),
    // The default is only ever used by tests that construct this facade by hand; in the app Nest
    // injects the real UsersService provider (with the real hidden-user source) for this param.
    private readonly users: UsersService = new UsersService(clickhouse, projects, NO_HIDDEN_USERS),
    private readonly summaries: SummariesService = new SummariesService(clickhouse, projects),
    private readonly insights: InsightsQueryService = new InsightsQueryService(
      clickhouse,
      projects,
      cohorts,
    ),
  ) {}

  async runInsightsQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<InsightsResponse> {
    return this.insights.runInsightsQuery(userId, projectId, body);
  }

  async listEventNames(userId: string, projectId: string): Promise<EventsMetaResponse> {
    return this.metadata.listEventNames(userId, projectId);
  }

  async listProperties(
    userId: string,
    projectId: string,
    event?: string,
  ): Promise<PropertiesMetaResponse> {
    return this.metadata.listProperties(userId, projectId, event);
  }

  async listPropertyValues(
    userId: string,
    projectId: string,
    property: string | undefined,
    event?: string,
    limitRaw?: string,
  ): Promise<PropertyValuesResponse> {
    return this.metadata.listPropertyValues(userId, projectId, property, event, limitRaw);
  }

  async getLiveEvents(
    userId: string,
    projectId: string,
    limitRaw?: string,
    beforeRaw?: string,
    sourceRaw?: string,
  ): Promise<LiveEventsResponse> {
    return this.users.getLiveEvents(userId, projectId, limitRaw, beforeRaw, sourceRaw);
  }

  async listUsers(
    userId: string,
    projectId: string,
    searchRaw?: string,
    limitRaw?: string,
    cursorRaw?: string,
  ): Promise<UsersResponse> {
    return this.users.listUsers(userId, projectId, searchRaw, limitRaw, cursorRaw);
  }

  async getUserProfile(
    userId: string,
    projectId: string,
    distinctId: string,
  ): Promise<UserProfileResponse> {
    return this.users.getUserProfile(userId, projectId, distinctId);
  }

  async getUserEvents(
    userId: string,
    projectId: string,
    distinctId: string,
    beforeRaw?: string,
    beforeIdRaw?: string,
  ): Promise<UserEventsResponse> {
    return this.users.getUserEvents(userId, projectId, distinctId, beforeRaw, beforeIdRaw);
  }

  async getSessionsSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    filtersRaw?: string,
  ): Promise<SessionsSummaryResponse> {
    return this.summaries.getSessionsSummary(userId, projectId, fromRaw, toRaw, filtersRaw);
  }

  async getRevenueSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    filtersRaw?: string,
  ): Promise<RevenueSummaryResponse> {
    return this.summaries.getRevenueSummary(userId, projectId, fromRaw, toRaw, filtersRaw);
  }
}
