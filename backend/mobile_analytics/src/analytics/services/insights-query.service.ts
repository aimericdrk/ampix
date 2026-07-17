import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { CohortsService } from '../../cohorts/cohorts.service';
import { ProjectsService } from '../../projects/core/projects.service';
import type { InsightsResponse, InsightsSeries } from '../analytics.types';
import { compileInsightsQuery } from '../queries/insights/insights.compiler';
import { insightsQuerySchema } from '../queries/insights/insights-query.schema';
import { zeroFill } from './analytics.shared';

interface TopBreakdownRow {
  breakdown_value: string;
  total: string | number;
}

interface SeriesRow {
  bucket_ts: string | number;
  breakdown_value?: string;
  value: string | number;
}

/**
 * `AnalyticsService`'s insights query engine (contracts §14): read-only over `analytics.events`,
 * always scoped by `project_id` and always gated by project membership (any role — "viewer+" is
 * satisfied by the mere existence of a Membership row, same as `ProjectsService.getEventsSummary`).
 * Reuses `ProjectsService.assertMembership` rather than duplicating the 404-then-403 tenancy check.
 * Split out of the former monolithic `AnalyticsService` — see that file for the facade.
 */
@Injectable()
export class InsightsQueryService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    private readonly cohorts: CohortsService,
  ) {}

  /**
   * Compiles + executes an insights query. Breakdown queries are 2-phase: first discover the top
   * `MAX_BREAKDOWN_VALUES` (insights.compiler.ts) values across all selected events, then run each
   * event's own bucketed series query restricted to those values. Raw events are queried directly
   * (not the rollup MVs) so results are exact — contracts §14's correctness note. An optional §16
   * `cohort_id` narrows every series to `distinct_id IN (<cohort subquery>)`, fully parameterized.
   */
  async runInsightsQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<InsightsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(insightsQuerySchema, body);
    const cohort = query.cohort_id
      ? await this.cohorts.resolveCohortPredicate(projectId, query.cohort_id)
      : undefined;
    const compiled = compileInsightsQuery(query, projectId, cohort);

    let breakdownValues: string[] | undefined;
    if (compiled.topBreakdownValuesQuery) {
      const rows = await this.clickhouse.query<TopBreakdownRow>(
        compiled.topBreakdownValuesQuery.sql,
        compiled.topBreakdownValuesQuery.params,
      );
      breakdownValues = rows.map((row) => row.breakdown_value);
    }

    const series: InsightsSeries[] = [];
    for (const seriesQuery of compiled.seriesQueries) {
      const params = breakdownValues
        ? { ...seriesQuery.params, breakdownValues }
        : seriesQuery.params;
      // `settings` is set only for `unique_users` series (contracts §17: the canonicalizing LEFT
      // JOIN needs `join_use_nulls=1`); `total` series pass `undefined` and keep default behavior.
      const rows = await this.clickhouse.query<SeriesRow>(
        seriesQuery.sql,
        params,
        seriesQuery.settings,
      );

      if (breakdownValues) {
        for (const breakdownValue of breakdownValues) {
          const rowsForValue = rows.filter((row) => row.breakdown_value === breakdownValue);
          series.push({
            name: seriesQuery.eventName,
            breakdown_value: breakdownValue,
            data: zeroFill(compiled.buckets, rowsForValue),
          });
        }
      } else {
        series.push({
          name: seriesQuery.eventName,
          breakdown_value: null,
          data: zeroFill(compiled.buckets, rows),
        });
      }
    }

    return { series };
  }
}
