import { Injectable } from '@nestjs/common';
import type { ZodError } from 'zod';
import { IngestEvent, EventSource, RejectedItem, ingestEventSchema } from '@myampix/contracts';
import { EventRow, toChDateTime64 } from '../clickhouse/clickhouse.service';

/** Contracts §4: client timestamp is clamped to [now-7d, now+5min]. */
export const TIMESTAMP_PAST_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
export const TIMESTAMP_FUTURE_LIMIT_MS = 5 * 60 * 1000;

export function clampTimestamp(clientTs: number, nowMs: number): number {
  return Math.min(
    Math.max(clientTs, nowMs - TIMESTAMP_PAST_LIMIT_MS),
    nowMs + TIMESTAMP_FUTURE_LIMIT_MS,
  );
}

/** Contract-style reject reasons: "missing insert_id" for absent fields, "field: message" otherwise. */
export function formatZodReason(error: ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join('.') || 'item';
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return `missing ${path}`;
  }
  return `${path}: ${issue.message}`;
}

export interface NormalizedBatch {
  rows: EventRow[];
  rejected: RejectedItem[];
}

/** Validates and normalizes a raw batch item-by-item (contracts §4: never all-or-nothing). */
@Injectable()
export class EventNormalizer {
  /**
   * `source` and `ip` are both server-derived and both parameters for the same reason: `source`
   * comes from the authenticated token (see SdkTokenGuard) and `ip` from the connection (see
   * clientIp), so neither is ever read off the event or its context — a client can no more claim
   * an address than it can claim to be a server.
   *
   * The two interact: `ip` is kept only for a CLIENT token, because only a client token is a
   * device. A server token's connection is one of your own backends (or RevenueCat's), so storing
   * its address would put the same egress IP on every user that backend writes about — and it
   * would sit in the dashboard under "Device properties", where it reads as the user's device.
   * Server-token rows therefore carry '' here, exactly as the RevenueCat webhook writer does.
   */
  normalizeBatch(
    projectId: string,
    items: unknown[],
    source: EventSource,
    ip: string,
    nowMs: number = Date.now(),
  ): NormalizedBatch {
    const rows: EventRow[] = [];
    const rejected: RejectedItem[] = [];
    items.forEach((item, index) => {
      const parsed = ingestEventSchema.safeParse(item);
      if (!parsed.success) {
        rejected.push({ index, reason: formatZodReason(parsed.error) });
        return;
      }
      rows.push(this.toRow(projectId, parsed.data, source, ip, nowMs));
    });
    return { rows, rejected };
  }

  private toRow(
    projectId: string,
    event: IngestEvent,
    source: EventSource,
    ip: string,
    nowMs: number,
  ): EventRow {
    const ctx = event.context ?? {};
    const str = (value: string | null | undefined): string => value ?? '';
    return {
      project_id: projectId,
      insert_id: event.insert_id,
      event: event.event,
      distinct_id: event.distinct_id,
      anon_id: event.anon_id,
      session_id: event.session_id,
      timestamp: toChDateTime64(clampTimestamp(event.timestamp, nowMs)),
      server_timestamp: toChDateTime64(nowMs),
      source,
      // Only a client token is a device — see normalizeBatch.
      ip: source === 'client' ? ip : '',
      properties: event.properties ?? {},
      app_version: str(ctx.app_version),
      app_build: str(ctx.app_build),
      os: str(ctx.os),
      os_version: str(ctx.os_version),
      device_model: str(ctx.device_model),
      device_manufacturer: str(ctx.device_manufacturer),
      locale: str(ctx.locale),
      timezone: str(ctx.timezone),
      screen_width: ctx.screen_width ?? 0,
      screen_height: ctx.screen_height ?? 0,
      network: str(ctx.network),
      sdk_version: str(ctx.sdk_version),
      utm_source: str(ctx.utm_source),
      utm_medium: str(ctx.utm_medium),
      utm_campaign: str(ctx.utm_campaign),
      utm_content: str(ctx.utm_content),
      utm_term: str(ctx.utm_term),
      first_utm_source: str(ctx.first_utm_source),
      first_utm_campaign: str(ctx.first_utm_campaign),
      install_referrer: str(ctx.install_referrer),
    };
  }
}
