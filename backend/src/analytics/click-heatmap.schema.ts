import { z } from 'zod';
import { dateRangeSchema, insightsFilterSchema } from './insights-query.schema';

/**
 * POST /query/click-heatmap request schema (contracts §19). Buckets `$tap` events for one screen into
 * a `cols×rows` grid after normalizing each tap position by the device screen size. Reuses the §14
 * date-range + filter schemas verbatim.
 */

const MIN_GRID = 1;
const MAX_GRID = 100;
const MAX_FILTERS = 20;

export const heatmapGridSchema = z.object({
  cols: z.number().int('cols must be an integer').min(MIN_GRID, 'cols must be >= 1').max(MAX_GRID, 'cols must be <= 100'),
  rows: z.number().int('rows must be an integer').min(MIN_GRID, 'rows must be >= 1').max(MAX_GRID, 'rows must be <= 100'),
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
