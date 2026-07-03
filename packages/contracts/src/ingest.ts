import { z } from 'zod';

/** Ingest SDK token format: `mam_` + 32 hex chars (shared contracts §4). */
export const SDK_TOKEN_REGEX = /^mam_[0-9a-f]{32}$/;

/** Reserved event names emitted by SDK autocapture (shared contracts §4). */
export const RESERVED_EVENTS = [
  '$first_open',
  '$app_open',
  '$app_background',
  '$session_start',
  '$session_end',
  '$screen_view',
  '$tap',
  '$rage_tap',
  '$identify',
  '$campaign_touch',
] as const;

/** Reserved property prefix (shared contracts §4). */
export const RESERVED_PROPERTY_PREFIX = '$';

/** Optional device/app context attached to every event (shared contracts §4). */
export const eventContextSchema = z
  .object({
    app_version: z.string().max(64),
    app_build: z.string().max(64),
    os: z.string().max(32),
    os_version: z.string().max(32),
    device_model: z.string().max(128),
    device_manufacturer: z.string().max(64),
    locale: z.string().max(32),
    timezone: z.string().max(64),
    screen_width: z.number().int().min(0).max(65535),
    screen_height: z.number().int().min(0).max(65535),
    network: z.string().max(32),
    sdk_version: z.string().max(32),
    utm_source: z.string().max(255).nullable(),
    utm_medium: z.string().max(255).nullable(),
    utm_campaign: z.string().max(1024).nullable(),
    utm_content: z.string().max(1024).nullable(),
    utm_term: z.string().max(1024).nullable(),
    first_utm_source: z.string().max(255).nullable(),
    first_utm_campaign: z.string().max(1024).nullable(),
    install_referrer: z.string().max(4096).nullable(),
  })
  .partial();

/** One event as sent by the SDK to POST /ingest/events (shared contracts §4). */
export const ingestEventSchema = z.object({
  insert_id: z.string().uuid(),
  event: z.string().min(1).max(255),
  distinct_id: z.string().min(1).max(255),
  anon_id: z.string().min(1).max(255),
  session_id: z.string().uuid(),
  timestamp: z.number().int().positive(),
  properties: z.record(z.string(), z.unknown()).optional(),
  context: eventContextSchema.optional(),
});

/**
 * Request envelope for POST /ingest/events. Items are `unknown` on purpose:
 * validation is per-item (accept/reject), never all-or-nothing.
 */
export const ingestEventsRequestSchema = z.object({
  events: z.array(z.unknown()).min(1),
});

export const profileOpSchema = z.enum(['set', 'set_once', 'increment', 'append', 'unset', 'delete']);

/** One profile operation for POST /ingest/profiles (shared contracts §4). */
export const profileOperationSchema = z.object({
  distinct_id: z.string().min(1).max(255),
  op: profileOpSchema,
  properties: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.number().int().positive(),
});

/** Request envelope for POST /ingest/profiles. Per-item validation, like events. */
export const ingestProfilesRequestSchema = z.object({
  operations: z.array(z.unknown()).min(1),
});

export type EventContext = z.infer<typeof eventContextSchema>;
export type IngestEvent = z.infer<typeof ingestEventSchema>;
export type ProfileOp = z.infer<typeof profileOpSchema>;
export type ProfileOperation = z.infer<typeof profileOperationSchema>;

/** One rejected batch item in a 202 response (shared contracts §4). */
export interface RejectedItem {
  index: number;
  reason: string;
}

/** 202 response body for both ingest endpoints (shared contracts §4). */
export interface IngestResponse {
  accepted: number;
  rejected: RejectedItem[];
}
