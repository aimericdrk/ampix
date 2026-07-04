import { z } from 'zod';
import { dateRangeSchema, insightsFilterSchema } from './insights-query.schema';

/**
 * POST /query/retention request schema (contracts §15). Cohort retention grid: users "born" (first
 * did `born_event` in the window) returning `period` intervals later via `return_event`.
 */

/** Period granularity (contracts §15). The `toStartOf*` bucket fn and the `dateDiff` unit are both
 *  selected from frozen maps keyed by this enum in retention.compiler.ts — never interpolated. */
export const RETENTION_INTERVALS = ['day', 'week'] as const;
export type RetentionInterval = (typeof RETENTION_INTERVALS)[number];

const MIN_PERIODS = 1;
const MAX_PERIODS = 30;
const MAX_EVENT_FILTERS = 20;

export const retentionEventSchema = z.object({
  name: z.string().trim().min(1).max(255),
  filters: z.array(insightsFilterSchema).max(MAX_EVENT_FILTERS).default([]),
});
export type RetentionEvent = z.infer<typeof retentionEventSchema>;

export const retentionQuerySchema = z.object({
  born_event: retentionEventSchema,
  // Defaults to `born_event` when omitted (handled in the compiler, since the default depends on
  // another field).
  return_event: retentionEventSchema.optional(),
  date_range: dateRangeSchema,
  interval: z.enum(RETENTION_INTERVALS),
  periods: z
    .number()
    .int('periods must be an integer')
    .min(MIN_PERIODS, 'periods must be >= 1')
    .max(MAX_PERIODS, 'periods must be <= 30'),
});
export type RetentionQuery = z.infer<typeof retentionQuerySchema>;
