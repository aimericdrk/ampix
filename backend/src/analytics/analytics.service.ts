import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { ClickHouseService, toChDateTime64 } from '../clickhouse/clickhouse.service';
import { ProjectsService } from '../projects/projects.service';
import type {
  EventsMetaResponse,
  InsightsResponse,
  InsightsSeries,
  PropertiesMetaResponse,
  PropertyMeta,
} from './analytics.types';
import { Bucket } from './bucket-grid';
import { compileInsightsQuery } from './insights.compiler';
import { insightsQuerySchema } from './insights-query.schema';
import { EVENT_COLUMN_WHITELIST } from './property-resolver';

/** contracts §14: metadata endpoints scan "distinct event names / property keys, last 30 days". */
const META_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

interface TopBreakdownRow {
  breakdown_value: string;
  total: string | number;
}

interface SeriesRow {
  bucket_ts: string | number;
  breakdown_value?: string;
  value: string | number;
}

interface MetaEventRow {
  event: string;
}

interface MetaPropertyKeyRow {
  key: string;
}

function sinceParam(): string {
  return toChDateTime64(Date.now() - META_LOOKBACK_MS);
}

/** Reindexes ClickHouse's (sparse) grouped rows onto the full zero-filled bucket grid. */
function zeroFill(
  buckets: Bucket[],
  rows: Pick<SeriesRow, 'bucket_ts' | 'value'>[],
): { t: string; value: number }[] {
  const byTs = new Map<number, number>();
  for (const row of rows) {
    byTs.set(Number(row.bucket_ts), Number(row.value));
  }
  return buckets.map((bucket) => ({ t: bucket.t, value: byTs.get(bucket.ts) ?? 0 }));
}

/**
 * Core analytics query engine (contracts §14): read-only over `analytics.events`, always scoped
 * by `project_id` and always gated by project membership (any role — "viewer+" is satisfied by
 * the mere existence of a Membership row, same as `ProjectsService.getEventsSummary`). Reuses
 * `ProjectsService.assertMembership` rather than duplicating the 404-then-403 tenancy check.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Compiles + executes an insights query. Breakdown queries are 2-phase: first discover the top
   * `MAX_BREAKDOWN_VALUES` (insights.compiler.ts) values across all selected events, then run each
   * event's own bucketed series query restricted to those values. Raw events are queried directly
   * (not the rollup MVs) so results are exact — contracts §14's correctness note.
   */
  async runInsightsQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<InsightsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(insightsQuerySchema, body);
    const compiled = compileInsightsQuery(query, projectId);

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
      const rows = await this.clickhouse.query<SeriesRow>(seriesQuery.sql, params);

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

  /** GET /meta/events — distinct event names, last 30 days. */
  async listEventNames(userId: string, projectId: string): Promise<EventsMetaResponse> {
    await this.projects.assertMembership(userId, projectId);
    const rows = await this.clickhouse.query<MetaEventRow>(
      `SELECT DISTINCT event
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
       ORDER BY event`,
      { projectId, since: sinceParam() },
    );
    return { events: rows.map((row) => row.event) };
  }

  /**
   * GET /meta/properties — known columns (`type: "column"`) plus distinct top-level `properties`
   * JSON keys seen in the last 30 days (`type: "string"`), optionally narrowed to one event name.
   */
  async listProperties(
    userId: string,
    projectId: string,
    event?: string,
  ): Promise<PropertiesMetaResponse> {
    await this.projects.assertMembership(userId, projectId);

    const columnProps: PropertyMeta[] = [...EVENT_COLUMN_WHITELIST]
      .sort()
      .map((name) => ({ name, type: 'column' as const }));

    const params: Record<string, unknown> = { projectId, since: sinceParam() };
    let eventClause = '';
    if (event !== undefined) {
      params.eventName = event;
      eventClause = 'AND event = {eventName:String}\n         ';
    }

    const rows = await this.clickhouse.query<MetaPropertyKeyRow>(
      `SELECT DISTINCT arrayJoin(JSONExtractKeys(toJSONString(properties))) AS key
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
         ${eventClause}LIMIT 200`,
      params,
    );
    const customProps: PropertyMeta[] = rows.map((row) => ({
      name: row.key,
      type: 'string' as const,
    }));

    return { properties: [...columnProps, ...customProps] };
  }
}
