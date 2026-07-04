import { z } from 'zod';
import { dateRangeSchema, insightsBreakdownSchema, insightsFilterSchema } from './insights-query.schema';

/**
 * POST /query/funnels request schema (contracts §15). Ordered conversion funnel over
 * ClickHouse `windowFunnel`. Reuses the §14 filter/breakdown schemas verbatim.
 */

/** `windowFunnel` ordering mode (contracts §15). The keyword is selected from a frozen map keyed
 *  by this enum in funnels.compiler.ts — never interpolated from raw input. */
export const FUNNEL_ORDERS = ['any', 'strict_order'] as const;
export type FunnelOrder = (typeof FUNNEL_ORDERS)[number];

const MIN_STEPS = 2;
const MAX_STEPS = 8;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;
const MAX_STEP_FILTERS = 20;

export const funnelStepSchema = z.object({
  event: z.string().trim().min(1).max(255),
  filters: z.array(insightsFilterSchema).max(MAX_STEP_FILTERS).default([]),
});
export type FunnelStep = z.infer<typeof funnelStepSchema>;

export const funnelsQuerySchema = z.object({
  steps: z
    .array(funnelStepSchema)
    .min(MIN_STEPS, '2..8 ordered steps required')
    .max(MAX_STEPS, 'at most 8 steps'),
  date_range: dateRangeSchema,
  window_days: z
    .number()
    .int('window_days must be an integer')
    .min(MIN_WINDOW_DAYS, 'window_days must be >= 1')
    .max(MAX_WINDOW_DAYS, 'window_days must be <= 365'),
  order: z.enum(FUNNEL_ORDERS).default('any'),
  breakdown: insightsBreakdownSchema.optional(),
});
export type FunnelsQuery = z.infer<typeof funnelsQuerySchema>;
