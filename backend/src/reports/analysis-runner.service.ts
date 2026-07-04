import { Injectable } from '@nestjs/common';
import { AdvancedAnalyticsService } from '../analytics/advanced-analytics.service';
import { AnalyticsService } from '../analytics/analytics.service';
import type {
  FlowResponse,
  FunnelResponse,
  InsightsResponse,
  RetentionResponse,
} from '../analytics/analytics.types';
import type { ReportKind, RunReportOverride } from './report.schema';

/** Any of the four §14/§15 analysis response shapes. */
export type AnalysisResult = InsightsResponse | FunnelResponse | RetentionResponse | FlowResponse;

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
  ) {}

  /**
   * Merges the optional `{ date_range?, cohort_id? }` override over `definition`, then dispatches to
   * the engine method for `kind`. `flows` has no `cohort_id` field, so an override cohort_id is
   * harmlessly stripped by the flows schema.
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
