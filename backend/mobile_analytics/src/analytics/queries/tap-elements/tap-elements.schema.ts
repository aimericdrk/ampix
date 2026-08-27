import { z } from 'zod';
import { dateRangeSchema, insightsFilterSchema } from '../insights/insights-query.schema';

/**
 * POST /query/tap-elements request schema. The same selection as the click-heatmap (one screen, a
 * date range, §14 filters, and the optional §17 identity set) but grouped by WHAT was tapped rather
 * than WHERE — so it stays exact on screens taller than one viewport, where a tap's position is
 * recorded in viewport coordinates and cannot be placed on a reference screenshot.
 */

const MAX_FILTERS = 20;
const MAX_DISTINCT_IDS = 1000;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

export const tapElementsQuerySchema = z.object({
  screen_name: z.string().trim().min(1).max(255),
  date_range: dateRangeSchema,
  filters: z.array(insightsFilterSchema).max(MAX_FILTERS).default([]),
  /** §17 identity set — see click-heatmap.schema.ts; same semantics, same raw-column filter. */
  distinct_ids: z.array(z.string().min(1)).max(MAX_DISTINCT_IDS).optional(),
  limit: z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
export type TapElementsQuery = z.infer<typeof tapElementsQuerySchema>;
