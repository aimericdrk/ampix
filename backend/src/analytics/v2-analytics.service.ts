import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProjectsService } from '../projects/projects.service';
import type {
  ClickHeatmapResponse,
  EngagementResponse,
  FlowResponse,
  HeatmapCell,
} from './analytics.types';
import { buildBucketGrid } from './bucket-grid';
import { clickHeatmapQuerySchema } from './click-heatmap.schema';
import { compileClickHeatmapQuery } from './click-heatmap.compiler';
import { ENGAGEMENT_METRIC, compileEngagement } from './engagement.compiler';
import { engagementIntervalSchema } from './engagement.schema';
import { buildFlowGraph, FlowUnitRow } from './flows.compiler';
import { resolveDateOnlyRange } from './read-query.util';
import { compileScreenPathQuery, markEntryAnchors } from './screen-paths.compiler';
import { screenPathsQuerySchema } from './screen-paths.schema';

/** Rounds a stickiness ratio to 4 decimals (mirrors AdvancedAnalyticsService's `round4`). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface HeatmapCellRow {
  cx: string | number;
  cy: string | number;
  cnt: string | number;
}

interface NewReturningRow {
  bucket_ts: string | number;
  new_users: string | number;
  returning_users: string | number;
}

interface RangeActiveRow {
  mau: string | number;
}

/**
 * v2 analytics query engine (contracts §19): click-heatmap, screen-paths, engagement. A sibling of
 * {@link AnalyticsService}/{@link AdvancedAnalyticsService} reusing the exact same machinery —
 * membership gate (`ProjectsService.assertMembership`, viewer+), `parseOrThrow`, the shared filter
 * compiler, `resolveProperty`, the §15 flow graph builder, the §17 canonicalization helper, and
 * fully-parameterized ClickHouse. All three endpoints are read-only.
 */
@Injectable()
export class V2AnalyticsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * POST /query/click-heatmap — buckets `$tap` positions for one screen into a `cols×rows` grid.
   * `total` is the sum of all cell counts (i.e. the qualifying taps, after 0-size screens are
   * dropped); empty cells are omitted by the GROUP BY.
   */
  async runClickHeatmap(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<ClickHeatmapResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(clickHeatmapQuerySchema, body);
    const compiled = compileClickHeatmapQuery(query, projectId);
    const rows = await this.clickhouse.query<HeatmapCellRow>(compiled.sql, compiled.params);

    const cells: HeatmapCell[] = rows.map((row) => ({
      cx: Number(row.cx),
      cy: Number(row.cy),
      count: Number(row.cnt),
    }));
    const total = cells.reduce((sum, cell) => sum + cell.count, 0);
    return { screen_name: query.screen_name, total, cells };
  }

  /**
   * POST /query/screen-paths — a §15-flows Sankey whose nodes are SCREENS (`$screen_name` of
   * `$screen_view`). The canonicalized query returns per-unit time-ordered screen sequences; the
   * shared {@link buildFlowGraph} extracts paths, aggregates `uniqExact(uid)` transitions, and folds
   * top-N/`$other`/`$end`. With no `anchor_screen`, each unit's entry screen is the path start.
   */
  async runScreenPaths(userId: string, projectId: string, body: unknown): Promise<FlowResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(screenPathsQuerySchema, body);
    const compiled = compileScreenPathQuery(query, projectId);
    const rows = await this.clickhouse.query<FlowUnitRow>(
      compiled.sql,
      compiled.params,
      compiled.settings,
    );
    const prepared = query.anchor_screen !== undefined ? rows : markEntryAnchors(rows);
    return buildFlowGraph(prepared, {
      direction: query.direction,
      steps: query.steps,
      maxNodesPerStep: query.max_nodes_per_step,
    });
  }

  /**
   * GET /metrics/engagement — DAU/WAU/MAU (per interval), stickiness (active/MAU) and
   * new-vs-returning, all by canonical `uid`. Buckets are zero-filled onto the same grid the query
   * engine uses so an idle bucket reads as `{ value: 0 }` rather than being omitted.
   */
  async getEngagement(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    intervalRaw?: string,
  ): Promise<EngagementResponse> {
    await this.projects.assertMembership(userId, projectId);
    const interval = parseOrThrow(engagementIntervalSchema, intervalRaw ?? 'day');
    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);

    const compiled = compileEngagement(projectId, from, to, interval);
    const [nrRows, activeRows] = await Promise.all([
      this.clickhouse.query<NewReturningRow>(
        compiled.newReturningQuery.sql,
        compiled.newReturningQuery.params,
        compiled.settings,
      ),
      this.clickhouse.query<RangeActiveRow>(
        compiled.rangeActiveQuery.sql,
        compiled.rangeActiveQuery.params,
        compiled.settings,
      ),
    ]);

    const byTs = new Map<number, { newUsers: number; returning: number }>();
    for (const row of nrRows) {
      byTs.set(Number(row.bucket_ts), {
        newUsers: Number(row.new_users),
        returning: Number(row.returning_users),
      });
    }
    const mau = Number(activeRows[0]?.mau ?? 0);
    const metric = ENGAGEMENT_METRIC[interval];

    const active = [];
    const stickiness = [];
    const new_vs_returning = [];
    for (const bucket of buildBucketGrid(from, to, interval)) {
      const cell = byTs.get(bucket.ts) ?? { newUsers: 0, returning: 0 };
      const activeValue = cell.newUsers + cell.returning;
      active.push({ t: bucket.t, metric, value: activeValue });
      stickiness.push({ t: bucket.t, value: mau > 0 ? round4(activeValue / mau) : 0 });
      new_vs_returning.push({ t: bucket.t, new: cell.newUsers, returning: cell.returning });
    }

    return { active, stickiness, new_vs_returning };
  }
}
