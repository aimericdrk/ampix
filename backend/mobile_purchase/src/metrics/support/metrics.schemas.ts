import { z } from 'zod';
import { GRANULARITIES } from './buckets';

export const ENVIRONMENTS = ['PRODUCTION', 'SANDBOX'] as const;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'must be an ISO 8601 date-time' });

/** Common metrics query: `from`/`to` (ISO, defaulting to a trailing 30-day window), `granularity`
 * (day|week|month, default day), `environment` (PRODUCTION|SANDBOX, default PRODUCTION). Transforms
 * to resolved Dates + defaults; rejects `from > to`. Parse via `parseOrThrow` for RFC-7807 400s. */
export const metricsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
    environment: z.enum(ENVIRONMENTS).default('PRODUCTION'),
  })
  .transform((q, ctx) => {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - THIRTY_DAYS_MS);
    if (from.getTime() > to.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be on or before to', path: ['from'] });
      return z.NEVER;
    }
    return { from, to, granularity: q.granularity, environment: q.environment };
  });

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
