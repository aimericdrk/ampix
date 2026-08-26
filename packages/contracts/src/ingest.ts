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

/** Identifiers and event names: non-empty string, at most 255 chars (shared contracts §4). */
const idSchema = z.string().min(1).max(255);

/** Client-supplied epoch timestamp in milliseconds. */
const epochMsSchema = z.number().int().positive();

const propertyScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * One flat property value: a scalar, null, or an array of scalars.
 * Nested objects and nested arrays are rejected (shared contracts §4).
 */
export const propertyValueSchema = z.union([propertyScalarSchema, z.array(propertyScalarSchema)]);

/** Flat property bag shared by events and profile operations (shared contracts §4). */
export const propertiesSchema = z.record(z.string(), propertyValueSchema);

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

/**
 * Who emitted an event: `client` = an SDK inside the app, `server` = a trusted backend
 * (the app's own backend, the RevenueCat webhook). Absent defaults to `client` — SDKs never
 * need to send it.
 */
export const EVENT_SOURCES = ['client', 'server'] as const;
export const eventSourceSchema = z.enum(EVENT_SOURCES);

/** One event as sent by the SDK to POST /ingest/events (shared contracts §4). */
export const ingestEventSchema = z.object({
  insert_id: z.string().uuid(),
  event: idSchema,
  distinct_id: idSchema,
  anon_id: idSchema,
  session_id: z.string().uuid(),
  timestamp: epochMsSchema,
  source: eventSourceSchema.optional(),
  properties: propertiesSchema.optional(),
  context: eventContextSchema.optional(),
});

/**
 * Request envelope for POST /ingest/events. Items are `unknown` on purpose:
 * validation is per-item (accept/reject), never all-or-nothing.
 * Envelope size (≤INGEST_MAX_BATCH, default 100) is enforced at the API layer — see contracts §4.
 */
export const ingestEventsRequestSchema = z.object({
  events: z.array(z.unknown()).min(1),
});

export const profileOpSchema = z.enum([
  'set',
  'set_once',
  'increment',
  'append',
  'unset',
  'delete',
]);

/** One profile operation for POST /ingest/profiles (shared contracts §4). */
export const profileOperationSchema = z.object({
  distinct_id: idSchema,
  op: profileOpSchema,
  properties: propertiesSchema.optional(),
  timestamp: epochMsSchema,
});

/**
 * Request envelope for POST /ingest/profiles. Per-item validation, like events.
 * Envelope size (≤INGEST_MAX_BATCH, default 100) is enforced at the API layer — see contracts §4.
 */
export const ingestProfilesRequestSchema = z.object({
  operations: z.array(z.unknown()).min(1),
});

export type EventContext = z.infer<typeof eventContextSchema>;
export type EventSource = z.infer<typeof eventSourceSchema>;
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
