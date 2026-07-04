import { z } from 'zod';
import { dateRangeSchema, insightsFilterSchema } from './insights-query.schema';

/**
 * POST /query/flows request schema (contracts §15). Event-sequence flow (Sankey) anchored at one
 * event, expanded `steps` hops forward or backward, grouped per session or per user.
 */

/** Expansion direction (contracts §15). Only ever branches TS array traversal — never SQL text. */
export const FLOW_DIRECTIONS = ['forward', 'backward'] as const;
export type FlowDirection = (typeof FLOW_DIRECTIONS)[number];

/** Aggregation unit (contracts §15). The split column is selected from a frozen map keyed by this
 *  enum in flows.compiler.ts — never interpolated. */
export const FLOW_UNITS = ['session', 'user'] as const;
export type FlowUnit = (typeof FLOW_UNITS)[number];

const MIN_STEPS = 1;
const MAX_STEPS = 5;
const MIN_NODES_PER_STEP = 1;
const MAX_NODES_PER_STEP = 20;
const MAX_ANCHOR_FILTERS = 20;

export const flowAnchorSchema = z.object({
  event: z.string().trim().min(1).max(255),
  filters: z.array(insightsFilterSchema).max(MAX_ANCHOR_FILTERS).default([]),
});
export type FlowAnchor = z.infer<typeof flowAnchorSchema>;

export const flowsQuerySchema = z.object({
  anchor: flowAnchorSchema,
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
export type FlowsQuery = z.infer<typeof flowsQuerySchema>;
