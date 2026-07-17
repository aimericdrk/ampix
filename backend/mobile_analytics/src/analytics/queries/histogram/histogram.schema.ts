import { z } from 'zod';
import { dateRangeSchema, insightsFilterSchema } from '../insights/insights-query.schema';

/**
 * POST /query/histogram request schema (contracts §19). Buckets a numeric event property into an
 * adaptive ClickHouse `histogram(bins)(...)` over a date range, reusing the §14 date-range + filter
 * schemas verbatim (same doctrine as `click-heatmap.schema.ts`).
 */

const MIN_BINS = 2;
const MAX_BINS = 50;
const DEFAULT_BINS = 20;
const MAX_FILTERS = 20;
const MAX_PROPERTY_LENGTH = 255;

export const histogramQuerySchema = z.object({
  event: z.string().trim().min(1).max(255),
  property: z.string().trim().min(1).max(MAX_PROPERTY_LENGTH),
  bins: z
    .number()
    .int('bins must be an integer')
    .min(MIN_BINS, `bins must be >= ${MIN_BINS}`)
    .max(MAX_BINS, `bins must be <= ${MAX_BINS}`)
    .default(DEFAULT_BINS),
  date_range: dateRangeSchema,
  filters: z.array(insightsFilterSchema).max(MAX_FILTERS).default([]),
});
export type HistogramQuery = z.infer<typeof histogramQuerySchema>;
