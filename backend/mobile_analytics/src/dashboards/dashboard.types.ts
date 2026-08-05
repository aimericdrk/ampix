import type { AnalysisResult } from '../reports/analysis-runner.service';
import type { ReportKind } from '../reports/report.schema';

/** GET /dashboards list item (contracts §16). */
export interface DashboardListItem {
  id: string;
  name: string;
  tile_count: number;
  updated_at: string;
}

/** One tile as returned by GET /dashboards/:id (contracts §16). */
export interface TileView {
  id: string;
  title: string;
  kind: ReportKind;
  saved_report_id: string | null;
  inline_definition: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
}

export interface DashboardDetail {
  id: string;
  name: string;
  tiles: TileView[];
}

/** One tile's run result in GET /dashboards/:id/data: the analysis response OR an isolated error. */
export interface TileResult {
  id: string;
  result: AnalysisResult | { error: string };
}

export interface DashboardData {
  tiles: TileResult[];
}
