import { z } from 'zod';
import {
  cohortIdSchema,
  dateRangeSchema,
  insightsFilterSchema,
} from '../insights/insights-query.schema';

/**
 * `POST /query/experiment` request schema — the A/B-test readout.
 *
 * An experiment is three things the engine cannot guess and the analyst must name:
 *
 *  - `variant_property` — WHERE the variant label lives. There is no fixed property name because
 *    apps assign variants however they already do (an event property, a super property, a value
 *    written onto the user profile at assignment time); the dashboard offers a property picker fed
 *    by `/meta/properties`. Resolved through the same injection-safe `resolveProperty` whitelist as
 *    every other §14 property reference.
 *  - `exposure_event` — WHEN a user entered the test. Every user who fired this event in the range
 *    with a non-empty variant is a participant, attributed to the variant on their FIRST exposure
 *    (`argMin`) so a mid-test reassignment cannot move someone between arms retroactively.
 *  - `goal_event` — what counts as a conversion, within `conversion_window_days` of exposure.
 *
 * The response's significance numbers are only meaningful if assignment was random and exposure was
 * logged for BOTH arms — this endpoint measures a test, it does not run one.
 */

/** Where the variant label is read from: the exposure event's own properties, or the user profile. */
export const VARIANT_TARGETS = ['event', 'profile'] as const;
export type VariantTarget = (typeof VARIANT_TARGETS)[number];

const MAX_FILTERS = 20;
const MIN_CONVERSION_WINDOW_DAYS = 1;
const MAX_CONVERSION_WINDOW_DAYS = 365;
const MAX_PROPERTY_LENGTH = 255;

export const experimentQuerySchema = z.object({
  variant_property: z.string().trim().min(1).max(MAX_PROPERTY_LENGTH),
  variant_target: z.enum(VARIANT_TARGETS).default('event'),
  exposure_event: z.string().trim().min(1).max(255),
  exposure_filters: z.array(insightsFilterSchema).max(MAX_FILTERS).default([]),
  goal_event: z.string().trim().min(1).max(255),
  goal_filters: z.array(insightsFilterSchema).max(MAX_FILTERS).default([]),
  date_range: dateRangeSchema,
  conversion_window_days: z
    .number()
    .int('conversion_window_days must be an integer')
    .min(MIN_CONVERSION_WINDOW_DAYS, 'conversion_window_days must be >= 1')
    .max(MAX_CONVERSION_WINDOW_DAYS, 'conversion_window_days must be <= 365')
    .default(7),
  /**
   * Which arm is the baseline every other arm is compared against. Optional: when omitted the
   * engine picks the largest arm by exposure, which is the control in practice for an even split
   * and is at least the most statistically stable choice otherwise. Bound as a query param, never
   * interpolated.
   */
  control_variant: z.string().trim().min(1).max(MAX_PROPERTY_LENGTH).optional(),
  cohort_id: cohortIdSchema.optional(),
});
export type ExperimentQuery = z.infer<typeof experimentQuerySchema>;
