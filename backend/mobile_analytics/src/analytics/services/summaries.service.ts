import { Injectable } from '@nestjs/common';
import { ClickHouseService, toChDateTime64 } from '../../clickhouse/clickhouse.service';
import { ProjectsService } from '../../projects/core/projects.service';
import type { RevenueSummaryResponse, SessionsSummaryResponse } from '../analytics.types';
import { buildBucketGrid, parseDateOnlyUTC } from '../support/bucket-grid';
import { canonicalization } from '../support/identity';
import { parseFiltersParam, resolveDateOnlyRange } from '../support/read-query.util';
import { compileFilterClauses } from '../support/filter-compiler';
import {
  DURATION_MS_EXPR,
  IN_APP_PURCHASE_EVENT,
  MS_PER_DAY,
  PRICE_EXPR,
  PRODUCT_ID_EXPR,
  SESSION_END_EVENT,
} from './analytics.shared';

interface SessionsTotalsRow {
  sessions: string | number;
  avg_duration_ms: string | number;
}

interface SessionsDayRow {
  day: string;
  sessions: string | number;
  avg_duration_ms: string | number;
}

interface RevenueTotalsRow {
  total_revenue: string | number;
  purchases: string | number;
  paying_users: string | number;
}

interface RevenueDayRow {
  day: string;
  revenue: string | number;
  purchases: string | number;
}

interface RevenueProductRow {
  product_id: string;
  revenue: string | number;
  purchases: string | number;
}

/**
 * `AnalyticsService`'s summary endpoints (contracts §14/§19): `/sessions/summary` and
 * `/metrics/revenue`. Split out of the former monolithic `AnalyticsService` — see that file for
 * the facade.
 */
@Injectable()
export class SummariesService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * GET /sessions/summary — `$session_end` is the SDK's reserved app-session-close autocapture
   * event (contracts §4); its `$duration_ms` property carries the session length. Two queries:
   * the overall totals (one row) and the per-day breakdown, both zero-filled onto the same
   * `buildBucketGrid(..., 'day')` grid the query engine uses, so days with no sessions read as
   * `{ sessions: 0, avg_duration_ms: 0 }` rather than being omitted. `if(count(...) = 0, 0, avg(...))`
   * sidesteps `avg()` over zero rows, which ClickHouse evaluates to NaN — not valid JSON.
   * `filtersRaw` (feat-02 §3.4/T2) is the optional base64url-encoded §14 filters array, decoded +
   * validated by `parseFiltersParam` and AND-joined (bound, via `compileFilterClauses`) into BOTH the
   * totals and `by_day` queries below; absent -> unchanged behavior.
   */
  async getSessionsSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    filtersRaw?: string,
  ): Promise<SessionsSummaryResponse> {
    await this.projects.assertMembership(userId, projectId);
    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);
    const filters = parseFiltersParam(filtersRaw);

    const params: Record<string, unknown> = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
    };
    const filterClauses = compileFilterClauses(filters, params);
    const whereClause = [
      'project_id = {projectId:UUID}',
      `event = '${SESSION_END_EVENT}'`,
      'timestamp >= {from:DateTime64}',
      'timestamp < {toExclusive:DateTime64}',
      ...filterClauses,
    ].join('\n         AND ');

    const [totalsRows, dayRows] = await Promise.all([
      this.clickhouse.query<SessionsTotalsRow>(
        `SELECT
           count(DISTINCT insert_id) AS sessions,
           if(count(DISTINCT insert_id) = 0, 0, avg(${DURATION_MS_EXPR})) AS avg_duration_ms
         FROM events
         WHERE ${whereClause}`,
        params,
      ),
      this.clickhouse.query<SessionsDayRow>(
        `SELECT
           toString(toDate(timestamp)) AS day,
           count(DISTINCT insert_id) AS sessions,
           if(count(DISTINCT insert_id) = 0, 0, avg(${DURATION_MS_EXPR})) AS avg_duration_ms
         FROM events
         WHERE ${whereClause}
         GROUP BY day
         ORDER BY day`,
        params,
      ),
    ]);

    const sessions = Number(totalsRows[0]?.sessions ?? 0);
    const avg_duration_ms = Number(totalsRows[0]?.avg_duration_ms ?? 0);

    const byDayMap = new Map(dayRows.map((row) => [row.day, row]));
    const by_day = buildBucketGrid(from, to, 'day').map((bucket) => {
      const row = byDayMap.get(bucket.t);
      return {
        t: bucket.t,
        sessions: row ? Number(row.sessions) : 0,
        avg_duration_ms: row ? Number(row.avg_duration_ms) : 0,
      };
    });

    return { sessions, avg_duration_ms, by_day };
  }

  /**
   * GET /metrics/revenue — `$in_app_purchase` is the SDK's reserved purchase-completed autocapture
   * event (contracts §4); its `$price`/`$product_id` properties carry the purchase amount and the
   * purchased SKU. Mirrors `getSessionsSummary`'s shape: an overall-totals query, a `by_day`
   * breakdown (zero-filled onto `buildBucketGrid(..., 'day')`), and a `by_product` breakdown (top 10
   * by revenue, empty product ids excluded — an event missing `$product_id` shouldn't pollute the
   * per-SKU breakdown). `paying_users` is identity-resolved via the shared `canonicalization()`
   * helper (contracts §17) so an anonymous->identified purchaser is counted once; the day/product
   * breakdowns don't need canonical ids (they're not counting users), so those two queries scan
   * `events` directly, matching the sessions-summary precedent. `arppu`/`avg_purchase_value` guard
   * their divisors to avoid NaN (not valid JSON) on zero purchases/payers. `filtersRaw` (feat-02
   * §3.4/T2) is the optional base64url-encoded §14 filters array, decoded + validated by
   * `parseFiltersParam` and AND-joined (bound, via `compileFilterClauses`) into the totals, `by_day`,
   * AND `by_product` queries below so the whole response stays consistently scoped; absent ->
   * unchanged behavior.
   */
  async getRevenueSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    filtersRaw?: string,
  ): Promise<RevenueSummaryResponse> {
    await this.projects.assertMembership(userId, projectId);
    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);
    const filters = parseFiltersParam(filtersRaw);

    const params: Record<string, unknown> = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
    };
    const filterClauses = compileFilterClauses(filters, params);
    const filterAndClause = filterClauses.map((clause) => `           AND ${clause}`).join('\n');
    const whereClause = [
      'project_id = {projectId:UUID}',
      `event = '${IN_APP_PURCHASE_EVENT}'`,
      'timestamp >= {from:DateTime64}',
      'timestamp < {toExclusive:DateTime64}',
      ...filterClauses,
    ].join('\n         AND ');

    const canon = canonicalization();

    const [totalsRows, dayRows, productRows] = await Promise.all([
      this.clickhouse.query<RevenueTotalsRow>(
        `WITH ${canon.cte}
         SELECT
           sum(${PRICE_EXPR}) AS total_revenue,
           count(DISTINCT e.insert_id) AS purchases,
           uniqExact(${canon.uid}) AS paying_users
         FROM events AS e
         ${canon.join}
         WHERE e.project_id = {projectId:UUID}
           AND e.event = '${IN_APP_PURCHASE_EVENT}'
           AND e.timestamp >= {from:DateTime64}
           AND e.timestamp < {toExclusive:DateTime64}
${filterAndClause}`,
        params,
        canon.settings,
      ),
      this.clickhouse.query<RevenueDayRow>(
        `SELECT
           toString(toDate(timestamp)) AS day,
           sum(${PRICE_EXPR}) AS revenue,
           count(DISTINCT insert_id) AS purchases
         FROM events
         WHERE ${whereClause}
         GROUP BY day
         ORDER BY day`,
        params,
      ),
      this.clickhouse.query<RevenueProductRow>(
        `SELECT
           ${PRODUCT_ID_EXPR} AS product_id,
           sum(${PRICE_EXPR}) AS revenue,
           count(DISTINCT insert_id) AS purchases
         FROM events
         WHERE ${whereClause}
           AND ${PRODUCT_ID_EXPR} != ''
         GROUP BY product_id
         ORDER BY revenue DESC
         LIMIT 10`,
        params,
      ),
    ]);

    const total_revenue = Number(totalsRows[0]?.total_revenue ?? 0);
    const purchases = Number(totalsRows[0]?.purchases ?? 0);
    const paying_users = Number(totalsRows[0]?.paying_users ?? 0);
    const arppu = paying_users === 0 ? 0 : total_revenue / paying_users;
    const avg_purchase_value = purchases === 0 ? 0 : total_revenue / purchases;

    const byDayMap = new Map(dayRows.map((row) => [row.day, row]));
    const by_day = buildBucketGrid(from, to, 'day').map((bucket) => {
      const row = byDayMap.get(bucket.t);
      return {
        t: bucket.t,
        revenue: row ? Number(row.revenue) : 0,
        purchases: row ? Number(row.purchases) : 0,
      };
    });

    const by_product = productRows.map((row) => ({
      product_id: row.product_id,
      revenue: Number(row.revenue),
      purchases: Number(row.purchases),
    }));

    return { total_revenue, purchases, paying_users, arppu, avg_purchase_value, by_day, by_product };
  }
}
