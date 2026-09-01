import { Injectable } from '@nestjs/common';
import { AdvancedAnalyticsService } from '../analytics/services/advanced-analytics.service';
import { AnalyticsService } from '../analytics/services/analytics.service';
import type {
  FlowResponse,
  FunnelResponse,
  InsightsResponse,
  RetentionResponse,
} from '../analytics/analytics.types';
import { ExperimentsService } from '../analytics/queries/experiments/experiments.service';
import type { ExperimentResponse } from '../analytics/queries/experiments/experiment.types';
import type { ReportKind, RunReportOverride } from './report.schema';

/** Any of the analysis response shapes a saved report / dashboard tile can hold. */
export type AnalysisResult =
  | InsightsResponse
  | FunnelResponse
  | RetentionResponse
  | FlowResponse
  | ExperimentResponse;

/**
 * Executes a stored/inline analysis definition through the EXISTING injection-safe engine
 * (contracts §16). Shared by saved-report `/run` and dashboard `/data`. The engine methods each
 * re-validate the definition with their §14/§15 zod schema (`parseOrThrow`) and re-check project
 * membership, so a stored definition is never trusted blindly — this is the only path to ClickHouse.
 */
@Injectable()
export class AnalysisRunnerService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly advanced: AdvancedAnalyticsService,
    private readonly experiments: ExperimentsService,
  ) {}

  /**
   * Merges the optional `{ date_range?, cohort_id? }` override over `definition`, then dispatches to
   * the engine method for `kind`. `flows` has no `cohort_id` field, so an override cohort_id is
   * harmlessly stripped by the flows schema. `experiment` accepts both, so a dashboard's date
   * picker re-runs the test over the chosen window like every other tile.
   */
  async run(
    userId: string,
    projectId: string,
    kind: ReportKind,
    definition: unknown,
    override: RunReportOverride = {},
  ): Promise<AnalysisResult> {
    const merged = this.merge(definition, override);
    switch (kind) {
      case 'insights':
        return this.analytics.runInsightsQuery(userId, projectId, merged);
      case 'funnel':
        return this.advanced.runFunnelQuery(userId, projectId, merged);
      case 'retention':
        return this.advanced.runRetentionQuery(userId, projectId, merged);
      case 'flows':
        return this.advanced.runFlowQuery(userId, projectId, merged);
      case 'experiment':
        return this.experiments.runExperimentQuery(userId, projectId, merged);
    }
  }

  private merge(definition: unknown, override: RunReportOverride): unknown {
    const base = (definition ?? {}) as Record<string, unknown>;
    return {
      ...base,
      ...(override.date_range !== undefined && { date_range: override.date_range }),
      ...(override.cohort_id !== undefined && { cohort_id: override.cohort_id }),
    };
  }
}
