import { z } from 'zod';

/** contracts §14: `total` -> `count(DISTINCT insert_id)`; `unique_users` -> `uniqExact(distinct_id)`. */
export const AGGREGATIONS = ['total', 'unique_users'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** contracts §14: bucket function -> `toStartOf*`/`toMonday`(timestamp). */
export const INTERVALS = ['hour', 'day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];

export const FILTER_OPS = ['eq', 'neq', 'contains', 'gt', 'lt', 'is_set', 'is_not_set'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

const MAX_EVENTS = 5;
// Not dictated by contracts §14, but a sane defense-in-depth bound: without it a client could grow
// the WHERE clause (and the number of bound params) without limit.
const MAX_FILTERS = 20;
const MAX_PROPERTY_LENGTH = 255;
const MAX_VALUE_LENGTH = 1000;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects syntactically-plausible but non-existent dates (e.g. `2026-02-30`). */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const dateOnlySchema = z
  .string()
  .regex(DATE_ONLY_RE, 'must be an ISO date (YYYY-MM-DD)')
  .refine(isRealCalendarDate, 'must be a real calendar date');

/**
 * Inclusive `{ from, to }` UTC date range with `from <= to` (contracts §14/§15). Shared verbatim by
 * the insights query and the Phase-4 funnels/retention/flows schemas so every endpoint validates
 * dates identically.
 */
export const dateRangeSchema = z
  .object({ from: dateOnlySchema, to: dateOnlySchema })
  .refine((range) => range.from <= range.to, { message: 'from must be <= to', path: ['to'] });

export const insightsEventSchema = z.object({
  name: z.string().trim().min(1).max(255),
  aggregation: z.enum(AGGREGATIONS),
});
export type InsightsEvent = z.infer<typeof insightsEventSchema>;

export const filterValueSchema = z.union([
  z.string().max(MAX_VALUE_LENGTH),
  z.number().finite(),
  z.boolean(),
]);
export type FilterValue = z.infer<typeof filterValueSchema>;

export const insightsFilterSchema = z
  .object({
    property: z.string().trim().min(1).max(MAX_PROPERTY_LENGTH),
    op: z.enum(FILTER_OPS),
    value: filterValueSchema.optional(),
    // RevenueCat spec §4.5 amendment: an omitted/`'event'` target keeps the existing
    // `analytics.events`-column/JSON-property behavior byte-for-byte; `'profile'` filters against
    // `analytics.user_profiles` instead (see `compileFilter` in filter-compiler.ts).
    target: z.enum(['event', 'profile']).optional(),
  })
  .refine(
    (filter) => filter.op === 'is_set' || filter.op === 'is_not_set' || filter.value !== undefined,
    {
      message: 'value is required for this operator',
      path: ['value'],
    },
  );
export type InsightsFilter = z.infer<typeof insightsFilterSchema>;

export const insightsBreakdownSchema = z.object({
  property: z.string().trim().min(1).max(MAX_PROPERTY_LENGTH),
});
export type InsightsBreakdown = z.infer<typeof insightsBreakdownSchema>;

/** §16: an optional top-level cohort reference; when set, the engine AND-joins the cohort's
 *  `distinct_id IN (…)` predicate (fully parameterized) into the §14/§15 query. */
export const cohortIdSchema = z.string().uuid();

export const insightsQuerySchema = z.object({
  events: z
    .array(insightsEventSchema)
    .min(1, '1..5 events required')
    .max(MAX_EVENTS, 'at most 5 events'),
  date_range: dateRangeSchema,
  interval: z.enum(INTERVALS),
  filters: z.array(insightsFilterSchema).max(MAX_FILTERS).default([]),
  breakdown: insightsBreakdownSchema.optional(),
  cohort_id: cohortIdSchema.optional(),
});
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
