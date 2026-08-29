import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/core/projects.service';
import type {
  ClickHeatmapResponse,
  TapElementsResponse,
  EngagementResponse,
  FlowResponse,
  HeatmapCell,
  HistogramBucket,
  HistogramResponse,
} from '../analytics.types';
import { buildBucketGrid } from '../support/bucket-grid';
import { clickHeatmapQuerySchema } from '../queries/click-heatmap/click-heatmap.schema';
import { compileClickHeatmapQuery } from '../queries/click-heatmap/click-heatmap.compiler';
import { tapElementsQuerySchema } from '../queries/tap-elements/tap-elements.schema';
import { compileTapElementsQuery } from '../queries/tap-elements/tap-elements.compiler';
import { ENGAGEMENT_METRIC, compileEngagement } from '../queries/engagement/engagement.compiler';
import { engagementIntervalSchema } from '../queries/engagement/engagement.schema';
import { buildFlowGraph, FlowUnitRow } from '../queries/flows/flows.compiler';
import { compileHistogramQuery } from '../queries/histogram/histogram.compiler';
import { histogramQuerySchema } from '../queries/histogram/histogram.schema';
import { parseFiltersParam, resolveDateOnlyRange } from '../support/read-query.util';
import { compileScreenPathQuery, markEntryAnchors } from '../queries/screen-paths/screen-paths.compiler';
import { screenPathsQuerySchema } from '../queries/screen-paths/screen-paths.schema';

/** Rounds a stickiness ratio to 4 decimals (mirrors AdvancedAnalyticsService's `round4`). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface TapElementRow {
  widget_type: string;
  widget_label: string;
  cnt: string;
  users: string;
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

/** ClickHouse `histogram()` returns an array of `(lower, upper, height)` tuples; the JSONEachRow
 *  wire format surfaces each tuple as a 3-element array. */
type HistogramBucketTuple = [string | number, string | number, string | number];

interface HistogramRow {
  buckets: HistogramBucketTuple[];
  cnt: string | number;
  mn: string | number | null;
  mx: string | number | null;
  avgVal: string | number | null;
  p50: string | number | null;
  p90: string | number | null;
}

/** Coerces a possibly-null/NaN aggregate result (e.g. `avg()`/`quantile()` over zero rows) to a
 *  finite number, defaulting to `0` — matching contracts §19's "empty -> zeros" rule. */
function toFiniteNumber(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * v2 analytics query engine (contracts §19): click-heatmap, histogram, screen-paths, engagement. A sibling of
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
    private readonly prisma: PrismaService,
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
    // The grid is stretched over the screen's stored reference image, so when the LATEST capture
    // (the one the dashboard displays) is a stitched full-page image, taps must be normalized
    // against ITS geometry — not each tap's own page height, which diverges whenever the stitch
    // was truncated at the SDK's viewport budget (see CaptureGeometry in the compiler).
    const latestCapture = await this.prisma.screenCapture.findFirst({
      where: { projectId, screenName: query.screen_name },
      orderBy: { capturedAt: 'desc' },
      select: { contentHeight: true, viewportHeight: true, contentTop: true },
    });
    const capture =
      latestCapture?.contentHeight && latestCapture.viewportHeight
        ? {
            contentHeight: latestCapture.contentHeight,
            viewportHeight: latestCapture.viewportHeight,
            // NULL = captured before the chrome-inclusive stitch, which had
            // no chrome — 0 is exact for those rows, not a guess.
            contentTop: latestCapture.contentTop ?? 0,
          }
        : undefined;
    const compiled = compileClickHeatmapQuery(query, projectId, capture);
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
   * POST /query/tap-elements — the `$tap`s on one screen ranked by the widget they hit.
   *
   * Unlike the heatmap this makes no geometric assumption, so it is the one that stays correct on
   * a screen taller than the viewport: tap positions are recorded in viewport coordinates with no
   * scroll offset, so they cannot be placed against a reference screenshot, but the widget that
   * was tapped is unambiguous wherever it happened to be.
   */
  async runTapElements(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<TapElementsResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(tapElementsQuerySchema, body);
    const compiled = compileTapElementsQuery(query, projectId);
    const rows = await this.clickhouse.query<TapElementRow>(compiled.sql, compiled.params);

    const elements = rows.map((row) => ({
      widget_type: row.widget_type ?? '',
      widget_label: row.widget_label ?? '',
      count: Number(row.cnt),
      users: Number(row.users),
    }));
    // `total` sums what came back, and `truncated` says so — reporting a screen total we did not
    // query would be a number nobody can reconcile against the list under it.
    const total = elements.reduce((sum, element) => sum + element.count, 0);
    return {
      screen_name: query.screen_name,
      total,
      truncated: elements.length === query.limit,
      elements,
    };
  }

  /**
   * POST /query/histogram — buckets a numeric event `property` (over a date range + §14 filters)
   * into an adaptive ClickHouse `histogram(bins)(...)`, alongside count/min/max/mean/p50/p90 of the
   * same value. Exactly one row always comes back from the aggregate query (even with zero matching
   * events); `cnt === 0` is treated as the contracts §19 "empty -> zeros/[]" case.
   */
  async runHistogram(userId: string, projectId: string, body: unknown): Promise<HistogramResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(histogramQuerySchema, body);
    const compiled = compileHistogramQuery(query, projectId);
    const rows = await this.clickhouse.query<HistogramRow>(compiled.sql, compiled.params);
    const row = rows[0];

    const total = row ? Number(row.cnt) : 0;
    if (!row || total === 0) {
      return { buckets: [], total: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0 };
    }

    const buckets: HistogramBucket[] = (row.buckets ?? []).map(([lower, upper, height]) => ({
      lower: Number(lower),
      upper: Number(upper),
      count: Math.round(Number(height)),
    }));

    return {
      buckets,
      total,
      min: toFiniteNumber(row.mn),
      max: toFiniteNumber(row.mx),
      mean: toFiniteNumber(row.avgVal),
      p50: toFiniteNumber(row.p50),
      p90: toFiniteNumber(row.p90),
    };
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
   * engine uses so an idle bucket reads as `{ value: 0 }` rather than being omitted. `filtersRaw`
   * (feat-02 §3.4/T2) is the optional base64url-encoded §14 filters array, decoded + validated by
   * `parseFiltersParam` and AND-joined into the engine's queries via `compileEngagement`; absent ->
   * unchanged behavior.
   */
  async getEngagement(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    intervalRaw?: string,
    filtersRaw?: string,
  ): Promise<EngagementResponse> {
    await this.projects.assertMembership(userId, projectId);
    const interval = parseOrThrow(engagementIntervalSchema, intervalRaw ?? 'day');
    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);
    const filters = parseFiltersParam(filtersRaw);

    const compiled = compileEngagement(projectId, from, to, interval, filters);
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
