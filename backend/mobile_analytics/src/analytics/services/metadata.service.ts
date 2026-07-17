import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { ProjectsService } from '../../projects/core/projects.service';
import type {
  EventsMetaResponse,
  PropertiesMetaResponse,
  PropertyMeta,
  PropertyValuesResponse,
} from '../analytics.types';
import { EVENT_COLUMN_WHITELIST, resolveProperty } from '../support/property-resolver';
import { clampPropertyValuesLimit } from '../support/read-query.util';
import { ProblemException } from '../../common/problem-details';
import { sinceParam } from './analytics.shared';

interface MetaEventRow {
  event: string;
}

interface MetaPropertyKeyRow {
  key: string;
}

interface PropertyValueRow {
  value: string;
}

/**
 * `AnalyticsService`'s metadata endpoints (contracts §14): distinct event names / property keys /
 * property values, all scoped to the trailing 30-day `sinceParam()` window. Split out of the
 * former monolithic `AnalyticsService` — see that file for the facade.
 */
@Injectable()
export class MetadataService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

  /** GET /meta/events — distinct event names, last 30 days. */
  async listEventNames(userId: string, projectId: string): Promise<EventsMetaResponse> {
    await this.projects.assertMembership(userId, projectId);
    const rows = await this.clickhouse.query<MetaEventRow>(
      `SELECT DISTINCT event
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
       ORDER BY event`,
      { projectId, since: sinceParam() },
    );
    return { events: rows.map((row) => row.event) };
  }

  /**
   * GET /meta/properties — known columns (`type: "column"`) plus distinct top-level `properties`
   * JSON keys seen in the last 30 days (`type: "string"`), optionally narrowed to one event name.
   */
  async listProperties(
    userId: string,
    projectId: string,
    event?: string,
  ): Promise<PropertiesMetaResponse> {
    await this.projects.assertMembership(userId, projectId);

    const columnProps: PropertyMeta[] = [...EVENT_COLUMN_WHITELIST]
      .sort()
      .map((name) => ({ name, type: 'column' as const }));

    const params: Record<string, unknown> = { projectId, since: sinceParam() };
    let eventClause = '';
    if (event !== undefined) {
      params.eventName = event;
      eventClause = 'AND event = {eventName:String}\n         ';
    }

    const rows = await this.clickhouse.query<MetaPropertyKeyRow>(
      `SELECT DISTINCT arrayJoin(JSONExtractKeys(toJSONString(properties))) AS key
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
         ${eventClause}LIMIT 200`,
      params,
    );
    const customProps: PropertyMeta[] = rows.map((row) => ({
      name: row.key,
      type: 'string' as const,
    }));

    return { properties: [...columnProps, ...customProps] };
  }

  /**
   * GET /meta/property-values — the DISTINCT values of ONE property over the last 30 days,
   * frequency-ranked (most frequent first), capped, with empty values excluded — a filter-value
   * autosuggest dropdown. `property` is resolved via {@link resolveProperty}: a whitelisted column
   * emits its own literal identifier, anything else is a custom JSON key bound as `{propKey:String}`
   * — the caller's string is NEVER interpolated into SQL. An absent/blank `property` is a 400 (no
   * sensible default value list to fall back to), matching the module's "malformed input -> 400"
   * rule. An optional `event` narrows the scan, bound as `{eventName:String}` exactly as
   * `listProperties` does. `limit` is clamped (never rejected) — default 50, max 200.
   */
  async listPropertyValues(
    userId: string,
    projectId: string,
    property: string | undefined,
    event?: string,
    limitRaw?: string,
  ): Promise<PropertyValuesResponse> {
    await this.projects.assertMembership(userId, projectId);

    if (property === undefined || property === '') {
      throw new ProblemException({ status: 400, title: 'Bad Request', detail: 'property: required' });
    }

    const limit = clampPropertyValuesLimit(limitRaw);
    const params: Record<string, unknown> = { projectId, since: sinceParam(), limit };
    const resolved = resolveProperty(property, 'propKey', params);

    let eventClause = '';
    if (event !== undefined) {
      params.eventName = event;
      eventClause = 'AND event = {eventName:String}\n         ';
    }

    const rows = await this.clickhouse.query<PropertyValueRow>(
      `SELECT ${resolved.expr} AS value, count() AS cnt
       FROM events
       WHERE project_id = {projectId:UUID}
         AND timestamp >= {since:DateTime64}
         AND ${resolved.expr} != ''
         ${eventClause}GROUP BY value
       ORDER BY cnt DESC, value ASC
       LIMIT {limit:UInt64}`,
      params,
    );
    return { values: rows.map((row) => row.value) };
  }
}
