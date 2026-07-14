import { z } from 'zod';
import { parseOrThrow } from '../auth/schemas/auth.schemas';
import { flowsQuerySchema } from '../analytics/flows.schema';
import { funnelsQuerySchema } from '../analytics/funnels.schema';
import {
  cohortIdSchema,
  dateRangeSchema,
  insightsQuerySchema,
} from '../analytics/insights-query.schema';
import { retentionQuerySchema } from '../analytics/retention.schema';

/**
 * Saved-report schema (contracts §16). A saved report is a named query of any analysis kind; its
 * `definition` is validated by the matching §14/§15 zod schema — the SAME schema is applied on write
 * AND before every `/run` (and for a dashboard tile's inline definition), so a stored definition is
 * never trusted blindly.
 */

export const REPORT_KINDS = ['insights', 'funnel', 'retention', 'flows'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const reportKindSchema = z.enum(REPORT_KINDS);

const MAX_NAME_LENGTH = 200;
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

/** The §14/§15 request schema that validates a definition of each kind. */
const DEFINITION_SCHEMA_BY_KIND = {
  insights: insightsQuerySchema,
  funnel: funnelsQuerySchema,
  retention: retentionQuerySchema,
  flows: flowsQuerySchema,
} as const;

/**
 * Validates a report/tile `definition` against the §14/§15 zod schema for its `kind` (400 on
 * mismatch), returning the parsed definition. Used on write AND before every run — the single place
 * a stored definition is trusted enough to reach the engine.
 */
export function validateReportDefinition(kind: ReportKind, definition: unknown): unknown {
  return parseOrThrow(DEFINITION_SCHEMA_BY_KIND[kind], definition);
}

/** POST /reports body. `definition` is structurally deferred to {@link validateReportDefinition}. */
export const createReportSchema = z.object({
  name: nameSchema,
  kind: reportKindSchema,
  definition: z.unknown(),
});
export type CreateReportDto = z.infer<typeof createReportSchema>;

/** PATCH /reports/:id body — name and/or definition (validated by the report's existing kind). */
export const updateReportSchema = z
  .object({
    name: nameSchema.optional(),
    definition: z.unknown().optional(),
  })
  .refine((body) => body.name !== undefined || 'definition' in body, {
    message: 'at least one of name or definition is required',
  });
export type UpdateReportDto = z.infer<typeof updateReportSchema>;

/** POST /reports/:id/run optional override merged over the stored definition (contracts §16). */
export const runReportOverrideSchema = z.object({
  date_range: dateRangeSchema.optional(),
  cohort_id: cohortIdSchema.optional(),
});
export type RunReportOverride = z.infer<typeof runReportOverrideSchema>;
