import type { ReportKind } from './report.schema';

/** GET /reports list item (contracts §16). */
export interface ReportListItem {
  id: string;
  name: string;
  kind: ReportKind;
  created_by: string;
  updated_at: string;
}

/** GET /reports/:id — the list item plus the full stored definition + created_at. */
export interface ReportDetail extends ReportListItem {
  definition: unknown;
  created_at: string;
}
