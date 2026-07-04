import type {
  AnalysisResult,
  FlowsResponse,
  FunnelResponse,
  InsightsResponse,
  ReportKind,
  RetentionInterval,
  RetentionResponse,
} from '../../../lib/api/types';
import { FlowsChart } from './FlowsChart';
import { FunnelChart } from './FunnelChart';
import { InsightsChart } from './InsightsChart';
import { RetentionChart } from './RetentionChart';

/** True when a run/tile result carries no data — callers render an empty state instead of a chart. */
export function analysisResultIsEmpty(kind: ReportKind, result: AnalysisResult): boolean {
  switch (kind) {
    case 'insights':
      return (result as InsightsResponse).series.length === 0;
    case 'funnel':
      return (result as FunnelResponse).steps.length === 0;
    case 'retention':
      return (result as RetentionResponse).cohorts.length === 0;
    case 'flows':
      return (result as FlowsResponse).nodes.length === 0;
  }
}

/**
 * Renders a saved-report / dashboard-tile result with the Phase 3–4 chart that matches its `kind`,
 * so a report and a live analysis view are visually identical. Every underlying chart already ships
 * the dataviz-compliant legend + accessible data table.
 */
export function ReportChart({
  kind,
  result,
  interval,
  eventOrder,
}: {
  kind: ReportKind;
  result: AnalysisResult;
  /** Retention column-header granularity, when known from the report's stored definition. */
  interval?: RetentionInterval;
  /** Insights color-stability order, when known; otherwise derived from the series order. */
  eventOrder?: string[];
}) {
  switch (kind) {
    case 'insights': {
      const r = result as InsightsResponse;
      const order = eventOrder ?? Array.from(new Set(r.series.map((s) => s.name)));
      return <InsightsChart series={r.series} eventOrder={order} />;
    }
    case 'funnel': {
      const r = result as FunnelResponse;
      return (
        <FunnelChart
          steps={r.steps}
          overallConversion={r.overall_conversion}
          breakdowns={r.breakdowns}
        />
      );
    }
    case 'retention': {
      const r = result as RetentionResponse;
      return <RetentionChart cohorts={r.cohorts} averages={r.averages} interval={interval ?? 'day'} />;
    }
    case 'flows': {
      const r = result as FlowsResponse;
      return <FlowsChart nodes={r.nodes} links={r.links} />;
    }
  }
}
