import { z } from 'zod';
import { dateRangeSchema, insightsFilterSchema } from '../insights/insights-query.schema';

/**
 * POST /query/click-heatmap request schema (contracts §19). Buckets `$tap` events for one screen into
 * a `cols×rows` grid after normalizing each tap position by the device screen size. Reuses the §14
 * date-range + filter schemas verbatim.
 */

const MIN_GRID = 1;
const MAX_COLS = 100;
/**
 * Rows are capped higher than columns because the two axes no longer span the same thing. Columns
 * span one screen width; rows span the stored capture's full content height, which for a stitched
 * full-page screenshot is up to `kMaxStitchedViewports` (6) viewports tall. A grid with SQUARE
 * cells therefore needs roughly `cols x (height / width)` rows — about 260 for a 6-viewport 9:19.5
 * page — and capping rows at 100 would force the caller to choose between square cells and
 * horizontal resolution. Neither bound costs anything at query time: the grid is pure arithmetic
 * over the scanned rows, and the response carries only the cells that actually hold taps.
 */
const MAX_ROWS = 400;
const MAX_FILTERS = 20;

export const heatmapGridSchema = z.object({
  cols: z.number().int('cols must be an integer').min(MIN_GRID, 'cols must be >= 1').max(MAX_COLS, 'cols must be <= 100'),
  rows: z.number().int('rows must be an integer').min(MIN_GRID, 'rows must be >= 1').max(MAX_ROWS, 'rows must be <= 400'),
});
export type HeatmapGrid = z.infer<typeof heatmapGridSchema>;

const MAX_DISTINCT_IDS = 1000;

export const clickHeatmapQuerySchema = z.object({
  screen_name: z.string().trim().min(1).max(255),
  date_range: dateRangeSchema,
  grid: heatmapGridSchema,
  filters: z.array(insightsFilterSchema).max(MAX_FILTERS).default([]),
  /**
   * Optional §17 per-user identity set — the canonical id plus every anon_id aliasing to it. When
   * present the compiler adds a raw-`distinct_id` IN filter so a per-user heatmap is identity-correct
   * (see click-heatmap.compiler.ts). Bounded so the generated IN list can't blow up.
   */
  distinct_ids: z.array(z.string().min(1)).max(MAX_DISTINCT_IDS).optional(),
});
export type ClickHeatmapQuery = z.infer<typeof clickHeatmapQuerySchema>;
