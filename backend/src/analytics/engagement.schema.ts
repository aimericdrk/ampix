import { z } from 'zod';

/**
 * GET /metrics/engagement query schema (contracts §19). The `interval` picks the active-user window
 * granularity (day→DAU, week→WAU, month→MAU). `from`/`to` are parsed like the other §14 read
 * endpoints (see read-query.util); this enum guards the interval, whose bucket function is selected
 * from a frozen map keyed by it in engagement.compiler.ts — never interpolated.
 */
export const ENGAGEMENT_INTERVALS = ['day', 'week', 'month'] as const;
export type EngagementInterval = (typeof ENGAGEMENT_INTERVALS)[number];
export const engagementIntervalSchema = z.enum(ENGAGEMENT_INTERVALS);
