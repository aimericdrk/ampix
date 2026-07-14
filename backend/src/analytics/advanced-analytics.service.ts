import { Injectable } from '@nestjs/common';
import { parseOrThrow } from '../auth/schemas/auth.schemas';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { CohortsService } from '../cohorts/cohorts.service';
import { ProjectsService } from '../projects/core/projects.service';
import type {
  FunnelBreakdownResult,
  FunnelResponse,
  FunnelStepResult,
  RetentionAverage,
  RetentionCohort,
  RetentionResponse,
  FlowResponse,
} from './analytics.types';
import { parseDateOnlyUTC } from './bucket-grid';
import {
  MAX_FUNNEL_BREAKDOWN_VALUES,
  compileFunnelQuery,
} from './funnels.compiler';
import { funnelsQuerySchema } from './funnels.schema';
import { compileRetentionQuery } from './retention.compiler';
import { retentionQuerySchema } from './retention.schema';
import { FLOW_OTHER } from './flows.compiler';
import { FlowUnitRow, buildFlowGraph, compileFlowQuery } from './flows.compiler';
import { flowsQuerySchema } from './flows.schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Rounds a conversion/retention rate to 4 decimals (contracts §15 responses quote ~2-4 dp). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface FunnelCountRow {
  breakdown_value?: string;
  [stepColumn: string]: string | number | undefined;
}

interface RetentionSizeRow {
  cohort: string;
  size: string | number;
}

interface RetentionGridRow {
  cohort: string;
  period: string | number;
  cnt: string | number;
}

/**
 * Advanced analysis query engine (contracts §15): funnels, retention, user flows. A sibling of
 * {@link AnalyticsService} (kept separate to hold each service under the 500-line limit) sharing
 * the exact §14 machinery — membership gate, `parseOrThrow`, the shared filter compiler,
 * `resolveProperty`, and fully-parameterized ClickHouse. All three endpoints are read-only and
 * viewer+ (any-member) gated via `ProjectsService.assertMembership`.
 */
@Injectable()
export class AdvancedAnalyticsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    private readonly cohorts: CohortsService,
  ) {}

  /**
   * POST /query/funnels — ordered conversion funnel (`windowFunnel`). One query returns per-step
   * user counts (`level >= k+1`); conversions are derived in TS. With a breakdown, the query groups
   * by the breakdown value; the top {@link MAX_FUNNEL_BREAKDOWN_VALUES} by entry volume are kept and
   * the rest folded into `$other`.
   */
  async runFunnelQuery(userId: string, projectId: string, body: unknown): Promise<FunnelResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(funnelsQuerySchema, body);
    const cohort = query.cohort_id
      ? await this.cohorts.resolveCohortPredicate(projectId, query.cohort_id)
      : undefined;
    const compiled = compileFunnelQuery(query, projectId, cohort);
    const rows = await this.clickhouse.query<FunnelCountRow>(compiled.sql, compiled.params);

    const readCounts = (row: FunnelCountRow | undefined): number[] =>
      Array.from({ length: compiled.stepCount }, (_, k) => Number(row?.[`step_${k}`] ?? 0));

    if (!compiled.hasBreakdown) {
      const counts = readCounts(rows[0]);
      return { steps: this.toFunnelSteps(query.steps, counts), overall_conversion: overall(counts) };
    }

    // Rows are already ordered by step_0 DESC. Keep the top N, fold the remainder into `$other`.
    const kept = rows.slice(0, MAX_FUNNEL_BREAKDOWN_VALUES);
    const rest = rows.slice(MAX_FUNNEL_BREAKDOWN_VALUES);
    const breakdowns: FunnelBreakdownResult[] = kept.map((row) => {
      const counts = readCounts(row);
      return {
        value: String(row.breakdown_value ?? ''),
        steps: this.toFunnelSteps(query.steps, counts),
        overall_conversion: overall(counts),
      };
    });
    if (rest.length > 0) {
      const folded = rest.reduce<number[]>(
        (acc, row) => readCounts(row).map((c, k) => acc[k] + c),
        new Array(compiled.stepCount).fill(0),
      );
      if (folded[0] > 0) {
        breakdowns.push({
          value: FLOW_OTHER,
          steps: this.toFunnelSteps(query.steps, folded),
          overall_conversion: overall(folded),
        });
      }
    }

    // The top-level `steps` are the aggregate across all breakdown values.
    const totals = rows.reduce<number[]>(
      (acc, row) => readCounts(row).map((c, k) => acc[k] + c),
      new Array(compiled.stepCount).fill(0),
    );
    return {
      steps: this.toFunnelSteps(query.steps, totals),
      overall_conversion: overall(totals),
      breakdowns,
    };
  }

  private toFunnelSteps(
    steps: { event: string }[],
    counts: number[],
  ): FunnelStepResult[] {
    const top = counts[0];
    return steps.map((step, k) => {
      const prev = k === 0 ? 0 : counts[k - 1];
      return {
        event: step.event,
        count: counts[k],
        conversion_from_prev: k === 0 ? 1 : prev > 0 ? round4(counts[k] / prev) : 0,
        conversion_from_top: k === 0 ? 1 : top > 0 ? round4(counts[k] / top) : 0,
      };
    });
  }

  /**
   * POST /query/retention — cohort retention grid. Two queries: cohort sizes and the per-period
   * return counts. Period 0 is the cohort itself (`count == size`, `rate == 1.0`); a cohort exposes
   * only periods whose full interval has elapsed by the `to` bound. `averages` are size-weighted.
   */
  async runRetentionQuery(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<RetentionResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(retentionQuerySchema, body);
    const cohort = query.cohort_id
      ? await this.cohorts.resolveCohortPredicate(projectId, query.cohort_id)
      : undefined;
    const compiled = compileRetentionQuery(query, projectId, cohort);

    const [sizeRows, gridRows] = await Promise.all([
      this.clickhouse.query<RetentionSizeRow>(compiled.sizesQuery.sql, compiled.sizesQuery.params),
      this.clickhouse.query<RetentionGridRow>(compiled.gridQuery.sql, compiled.gridQuery.params),
    ]);

    // grid[cohort][period] = returning users.
    const grid = new Map<string, Map<number, number>>();
    for (const row of gridRows) {
      const byPeriod = grid.get(row.cohort) ?? new Map<number, number>();
      byPeriod.set(Number(row.period), Number(row.cnt));
      grid.set(row.cohort, byPeriod);
    }

    const intervalMs = query.interval === 'week' ? 7 * MS_PER_DAY : MS_PER_DAY;
    const toExclusiveMs = parseDateOnlyUTC(query.date_range.to) + MS_PER_DAY;

    const cohorts: RetentionCohort[] = [];
    // period -> { count, size } summed over cohorts that expose it (for the size-weighted average).
    const periodTotals = new Map<number, { count: number; size: number }>();

    for (const sizeRow of sizeRows) {
      const cohort = sizeRow.cohort;
      const size = Number(sizeRow.size);
      const bornBucketMs = parseDateOnlyUTC(cohort);
      // Number of fully-elapsed intervals after birth by the `to` bound; always exposes period 0.
      const elapsedMax = Math.floor((toExclusiveMs - bornBucketMs) / intervalMs) - 1;
      const maxPeriod = Math.max(0, Math.min(query.periods, elapsedMax));

      const byPeriod = grid.get(cohort);
      const periods = [];
      for (let p = 0; p <= maxPeriod; p++) {
        const count = p === 0 ? size : byPeriod?.get(p) ?? 0;
        const rate = size > 0 ? round4(count / size) : 0;
        periods.push({ period: p, count, rate });

        const totals = periodTotals.get(p) ?? { count: 0, size: 0 };
        totals.count += count;
        totals.size += size;
        periodTotals.set(p, totals);
      }
      cohorts.push({ cohort, size, periods });
    }

    const averages: RetentionAverage[] = [...periodTotals.keys()]
      .sort((a, b) => a - b)
      .map((period) => {
        const totals = periodTotals.get(period)!;
        return { period, rate: totals.size > 0 ? round4(totals.count / totals.size) : 0 };
      });

    return { cohorts, averages };
  }

  /**
   * POST /query/flows — event-sequence Sankey anchored at one event. The query returns time-ordered
   * per-unit sequences; {@link buildFlowGraph} extracts paths, aggregates `uniqExact(distinct_id)`
   * transitions, and folds top-N/`$other`/`$end`.
   */
  async runFlowQuery(userId: string, projectId: string, body: unknown): Promise<FlowResponse> {
    await this.projects.assertMembership(userId, projectId);
    const query = parseOrThrow(flowsQuerySchema, body);
    const compiled = compileFlowQuery(query, projectId);
    const rows = await this.clickhouse.query<FlowUnitRow>(compiled.sql, compiled.params);
    return buildFlowGraph(rows, {
      direction: query.direction,
      steps: query.steps,
      maxNodesPerStep: query.max_nodes_per_step,
    });
  }
}

/** overall conversion = last-step count / first-step count (`0` when the funnel has no entrants). */
function overall(counts: number[]): number {
  const top = counts[0];
  const last = counts[counts.length - 1];
  return top > 0 ? round4(last / top) : 0;
}
