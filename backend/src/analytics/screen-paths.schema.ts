import { z } from 'zod';
import { dateRangeSchema } from './insights-query.schema';
import { FLOW_DIRECTIONS, FLOW_UNITS } from './flows.schema';

/**
 * POST /query/screen-paths request schema (contracts §19). Like §15 flows, but the graph nodes are
 * SCREENS (the `$screen_name` property of `$screen_view` events) rather than event names. Reuses the
 * §15 direction/unit enums and the §14 date-range schema. `anchor_screen` is optional: when omitted
 * the paths start from each unit's entry (first) screen.
 */

const MIN_STEPS = 1;
const MAX_STEPS = 5;
const MIN_NODES_PER_STEP = 1;
const MAX_NODES_PER_STEP = 20;

export const screenPathsQuerySchema = z.object({
  anchor_screen: z.string().trim().min(1).max(255).optional(),
  direction: z.enum(FLOW_DIRECTIONS).default('forward'),
  date_range: dateRangeSchema,
  steps: z
    .number()
    .int('steps must be an integer')
    .min(MIN_STEPS, 'steps must be >= 1')
    .max(MAX_STEPS, 'steps must be <= 5'),
  max_nodes_per_step: z
    .number()
    .int('max_nodes_per_step must be an integer')
    .min(MIN_NODES_PER_STEP, 'max_nodes_per_step must be >= 1')
    .max(MAX_NODES_PER_STEP, 'max_nodes_per_step must be <= 20'),
  unit: z.enum(FLOW_UNITS).default('session'),
});
export type ScreenPathsQuery = z.infer<typeof screenPathsQuerySchema>;
