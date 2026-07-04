import { z } from 'zod';
import { FILTER_OPS, filterValueSchema, insightsFilterSchema } from '../analytics/insights-query.schema';

/**
 * Cohort definition schema (contracts §16). A cohort is a saved audience: a `match` mode (`all` =
 * AND / `any` = OR) over 1..10 conditions. Each condition is one of:
 *  - `behavior`  — did an event `{op} {count}` times within the last `within_days` days (with §14 filters);
 *  - `did_not`   — performed the event 0 times in the window;
 *  - `property`  — a §14 filter over a known column / custom property (via `resolveProperty`).
 *
 * The SAME schema validates a definition on write AND before every run (preview / cohort_id filter),
 * so a stored definition is never trusted blindly — the injection-safe compiler is the only path to CH.
 */

/** `all` intersects the condition id-sets; `any` unions them (contracts §16). */
export const COHORT_MATCH = ['all', 'any'] as const;
export type CohortMatch = (typeof COHORT_MATCH)[number];

/** Count-comparison operators for a `behavior` condition (contracts §16 `HAVING count() {op} {n}`).
 *  Structural keywords: the SQL operator is picked from a frozen map keyed by this enum in the
 *  compiler — never interpolated from raw input. */
export const COHORT_COUNT_OPS = ['gte', 'gt', 'lte', 'lt', 'eq'] as const;
export type CohortCountOp = (typeof COHORT_COUNT_OPS)[number];

const MAX_CONDITIONS = 10;
const MAX_CONDITION_FILTERS = 20;
const MAX_COUNT = 1_000_000_000;
const MAX_WITHIN_DAYS = 3650;
const MAX_NAME_LENGTH = 200;

const eventNameSchema = z.string().trim().min(1).max(255);
const withinDaysSchema = z
  .number()
  .int('within_days must be an integer')
  .min(1, 'within_days must be >= 1')
  .max(MAX_WITHIN_DAYS, 'within_days must be <= 3650');
const conditionFiltersSchema = z.array(insightsFilterSchema).max(MAX_CONDITION_FILTERS).default([]);

export const behaviorConditionSchema = z.object({
  type: z.literal('behavior'),
  event: eventNameSchema,
  op: z.enum(COHORT_COUNT_OPS),
  count: z.number().int('count must be an integer').min(0, 'count must be >= 0').max(MAX_COUNT),
  within_days: withinDaysSchema,
  filters: conditionFiltersSchema,
});
export type BehaviorCondition = z.infer<typeof behaviorConditionSchema>;

export const didNotConditionSchema = z.object({
  type: z.literal('did_not'),
  event: eventNameSchema,
  within_days: withinDaysSchema,
  filters: conditionFiltersSchema,
});
export type DidNotCondition = z.infer<typeof didNotConditionSchema>;

/** A `property` condition is exactly a §14 filter (property/op/value) tagged with `type`. */
export const propertyConditionSchema = z
  .object({
    type: z.literal('property'),
    property: z.string().trim().min(1).max(255),
    op: z.enum(FILTER_OPS),
    value: filterValueSchema.optional(),
  })
  .refine(
    (cond) => cond.op === 'is_set' || cond.op === 'is_not_set' || cond.value !== undefined,
    { message: 'value is required for this operator', path: ['value'] },
  );
export type PropertyCondition = z.infer<typeof propertyConditionSchema>;

export const cohortConditionSchema = z.union([
  behaviorConditionSchema,
  didNotConditionSchema,
  propertyConditionSchema,
]);
export type CohortCondition = z.infer<typeof cohortConditionSchema>;

export const cohortDefinitionSchema = z.object({
  match: z.enum(COHORT_MATCH),
  conditions: z
    .array(cohortConditionSchema)
    .min(1, '1..10 conditions required')
    .max(MAX_CONDITIONS, 'at most 10 conditions'),
});
export type CohortDefinition = z.infer<typeof cohortDefinitionSchema>;

/** POST /cohorts body. */
export const createCohortSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  definition: cohortDefinitionSchema,
});
export type CreateCohortDto = z.infer<typeof createCohortSchema>;

/** PATCH /cohorts/:id body — name and/or definition, at least one present. */
export const updateCohortSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
    definition: cohortDefinitionSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.definition !== undefined, {
    message: 'at least one of name or definition is required',
  });
export type UpdateCohortDto = z.infer<typeof updateCohortSchema>;
