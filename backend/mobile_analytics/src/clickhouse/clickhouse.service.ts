import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ClickHouseClient, createClient } from '@clickhouse/client';
import type { ClickHouseSettings } from '@clickhouse/client';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/** One row of analytics.events — columns exactly per shared contracts §5. */
export interface EventRow {
  project_id: string;
  insert_id: string;
  event: string;
  distinct_id: string;
  anon_id: string;
  session_id: string;
  timestamp: string;
  server_timestamp: string;
  properties: Record<string, unknown>;
  app_version: string;
  app_build: string;
  os: string;
  os_version: string;
  device_model: string;
  device_manufacturer: string;
  locale: string;
  timezone: string;
  screen_width: number;
  screen_height: number;
  network: string;
  sdk_version: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  first_utm_source: string;
  first_utm_campaign: string;
  install_referrer: string;
}

/** One row of analytics.user_profiles (shared contracts §5). */
export interface ProfileRow {
  project_id: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  updated_at: string;
}

/** Writer abstraction so Pub/Sub or a CH cluster can replace direct writes later (master design §2). */
export interface EventSink {
  insertEvents(rows: EventRow[]): Promise<void>;
}

/** Formats a ms epoch as a ClickHouse DateTime64(3) UTC literal: 'YYYY-MM-DD HH:mm:ss.SSS'. */
export function toChDateTime64(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 23);
}

/**
 * Inverse of {@link toChDateTime64}: turns a ClickHouse DateTime64(3, 'UTC') value as returned by
 * JSONEachRow ('YYYY-MM-DD HH:mm:ss.SSS') back into a standard ISO-8601 UTC instant
 * ('YYYY-MM-DDTHH:mm:ss.SSSZ') for API responses (contracts §14: live feed / users / sessions
 * timestamps are all `<iso>`). Pure string surgery — the value is already UTC wall-clock text with
 * no timezone marker, so no `Date` round-trip (and its precision-loss risk) is needed.
 */
export function fromChDateTime64(raw: string): string {
  return `${raw.replace(' ', 'T')}Z`;
}

@Injectable()
export class ClickHouseService implements EventSink, OnApplicationShutdown {
  private readonly client: ClickHouseClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createClient({
      url: config.clickhouse.url,
      username: config.clickhouse.user,
      password: config.clickhouse.password,
      database: config.clickhouse.database,
      clickhouse_settings: {
        // Stateless Cloud Run rule: batching happens inside ClickHouse; the 202 is only
        // returned once ClickHouse durably acked (wait_for_async_insert=1).
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_busy_timeout_ms: 1000,
        date_time_input_format: 'best_effort',
      },
    });
  }

  async insertEvents(rows: EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'events', values: rows, format: 'JSONEachRow' });
  }

  async insertProfiles(rows: ProfileRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'user_profiles', values: rows, format: 'JSONEachRow' });
  }

  /**
   * Parameterized query — user input must always bind via {name:Type} params, never
   * interpolation. Callers may pass per-call `settings` (e.g. ProfileWriter disables
   * `output_format_json_quote_64bit_integers` to round-trip numbers through the JSON
   * column type); by default ClickHouse's settings, including its 64-bit-integer
   * precision guard, are left untouched.
   */
  async query<T>(
    sql: string,
    params: Record<string, unknown> = {},
    settings?: ClickHouseSettings,
  ): Promise<T[]> {
    const result = await this.client.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
      clickhouse_settings: settings,
    });
    return result.json<T>();
  }

  /** Every ClickHouse table keyed by `project_id` — the full set a project's data lives in. */
  private static readonly PROJECT_SCOPED_TABLES = [
    'events',
    'user_profiles',
    'identity_mappings',
    'daily_active_users',
    'daily_event_counts',
    'daily_sessions',
  ] as const;

  /**
   * Lightweight-deletes every row belonging to one project across all project-scoped tables
   * (raw events + profiles + identity mappings + the daily rollups). Used by the owner-gated
   * project data purge. The table list is a fixed constant; `projectId` binds as a param and is
   * never interpolated.
   */
  async deleteProjectData(projectId: string): Promise<void> {
    for (const table of ClickHouseService.PROJECT_SCOPED_TABLES) {
      await this.client.command({
        query: `DELETE FROM ${table} WHERE project_id = {projectId:UUID}`,
        query_params: { projectId },
      });
    }
  }

  async ping(): Promise<boolean> {
    const result = await this.client.ping();
    return result.success;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
