import { Injectable } from '@nestjs/common';
import { ClickHouseService, toChDateTime64 } from '../../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from '../../analytics/support/bucket-grid';
import { compileFilterClauses } from '../../analytics/support/filter-compiler';
import { parseFiltersParam, resolveDateOnlyRange } from '../../analytics/support/read-query.util';
import { ProblemException } from '../../common/problem-details';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/core/projects.service';
import {
  CANCEL_REASON_EXPR,
  EXPIRATION_REASON_EXPR,
  MS_PER_DAY,
  PERIOD_EXPR,
  PRICE_EXPR,
  PRODUCT_ID_EXPR,
  RC_CANCELLATION,
  RC_EXPIRATION,
  RC_INITIAL,
  RC_LINK_EVENT,
  RC_NON_RENEWING,
  RC_RENEWAL,
  RECENT_EVENTS_LIMIT,
} from './rc-metrics.constants';

export interface SubscriptionsSummaryResponse {
  mrr_cents: number;
  active: number;
  in_trial: number;
  grace: number;
  new_subscriptions: number;
  churned: number;
  trials_started: number;
  trials_converted: number;
  by_day: Array<{ t: string; new_subscriptions: number; churned: number; revenue: number }>;
  by_product: Array<{ product_id: string; active: number; mrr_cents: number }>;
  by_store: Array<{ store: string; active: number }>;
  churn_reasons: Array<{ reason: string; count: number }>;
  recent_events: Array<{
    insert_id: string;
    event: string;
    distinct_id: string;
    timestamp: string;
    product_id: string;
    price: number;
  }>;
}

interface SubsTrialsRow {
  subs: string | number;
  trials: string | number;
}

interface ChurnedRow {
  churned: string | number;
}

interface ConvertedRow {
  converted: string | number;
}

interface ByDayRow {
  t: string;
  new_subscriptions: string | number;
  churned: string | number;
  revenue: string | number;
}

interface ChurnReasonRow {
  reason: string;
  count: string | number;
}

interface RecentEventRow {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  product_id: string;
  price: string | number;
}

/**
 * `GET /metrics/subscriptions` (Subscriptions page). Current-state KPIs (mrr/active/in_trial/grace,
 * by_product, by_store) read `SubscriptionState` in Postgres and are deliberately NOT scoped by
 * `filters`/date range — they're the live state as of now, not a historical query (the dashboard
 * marks those tiles `unfiltered`). The lifecycle KPIs (new_subscriptions/churned/trials_*) and the
 * by_day/churn_reasons/recent_events breakdowns read ClickHouse `events` in the requested range,
 * copying `getRevenueSummary`'s date/filter plumbing verbatim (`analytics.service.ts`): only
 * `new_subscriptions`/`trials_started` and `by_day` are scoped by the optional `filters` param —
 * churned/trials_converted/churn_reasons/recent_events intentionally aren't (they're lifecycle
 * facts about the whole population, not a filtered cohort's totals).
 */
@Injectable()
export class RcSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

  async getSummary(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
    filtersRaw?: string,
  ): Promise<SubscriptionsSummaryResponse> {
    await this.projects.assertMembership(userId, projectId);

    const integration = await this.prisma.revenueCatIntegration.findUnique({
      where: { projectId },
    });
    if (integration === null) {
      throw new ProblemException({
        status: 404,
        title: 'Not Found',
        detail: 'RevenueCat integration not found',
      });
    }

    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);
    const filters = parseFiltersParam(filtersRaw);

    const params: Record<string, unknown> = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
    };
    const filterClauses = compileFilterClauses(filters, params);
    const filterAndClause = filterClauses.map((clause) => `           AND ${clause}`).join('\n');

    const [
      { active, in_trial, grace, mrr_cents, by_product, by_store },
      [subsTrialsRows, churnedRows, convertedRows, byDayRows, churnReasonRows, recentEventRows],
    ] = await Promise.all([
      this.getStateKpis(projectId),
      Promise.all([
        this.clickhouse.query<SubsTrialsRow>(
          `SELECT
             countIf(${PERIOD_EXPR} != 'TRIAL') AS subs,
             countIf(${PERIOD_EXPR} = 'TRIAL') AS trials
           FROM events AS e
           WHERE e.project_id = {projectId:UUID}
             AND e.event = '${RC_INITIAL}'
             AND e.timestamp >= {from:DateTime64}
             AND e.timestamp < {toExclusive:DateTime64}
${filterAndClause}`,
          params,
        ),
        this.clickhouse.query<ChurnedRow>(
          `SELECT count() AS churned
           FROM events AS e
           WHERE e.project_id = {projectId:UUID}
             AND e.event = '${RC_EXPIRATION}'
             AND e.timestamp >= {from:DateTime64}
             AND e.timestamp < {toExclusive:DateTime64}`,
          params,
        ),
        this.clickhouse.query<ConvertedRow>(
          `SELECT uniqExact(distinct_id) AS converted
           FROM (
             SELECT distinct_id, min(timestamp) AS first_renewal
             FROM events
             WHERE project_id = {projectId:UUID}
               AND event = '${RC_RENEWAL}'
             GROUP BY distinct_id
           )
           WHERE first_renewal >= {from:DateTime64}
             AND first_renewal < {toExclusive:DateTime64}
             AND distinct_id IN (
               SELECT distinct_id
               FROM events
               WHERE project_id = {projectId:UUID}
                 AND event = '${RC_INITIAL}'
                 AND ${PERIOD_EXPR} = 'TRIAL'
             )`,
          params,
        ),
        this.clickhouse.query<ByDayRow>(
          `SELECT
             toString(toDate(timestamp)) AS t,
             countIf(event = '${RC_INITIAL}') AS new_subscriptions,
             countIf(event = '${RC_EXPIRATION}') AS churned,
             sumIf(${PRICE_EXPR}, event IN ('${RC_INITIAL}', '${RC_RENEWAL}', '${RC_NON_RENEWING}')) AS revenue
           FROM events AS e
           WHERE e.project_id = {projectId:UUID}
             AND e.timestamp >= {from:DateTime64}
             AND e.timestamp < {toExclusive:DateTime64}
             AND event LIKE '$rc\\_%'
             AND event != '${RC_LINK_EVENT}'
${filterAndClause}
           GROUP BY t
           ORDER BY t`,
          params,
        ),
        this.clickhouse.query<ChurnReasonRow>(
          `SELECT
             coalesce(
               nullif(${EXPIRATION_REASON_EXPR}, ''),
               nullif(${CANCEL_REASON_EXPR}, ''),
               'UNKNOWN'
             ) AS reason,
             count() AS count
           FROM events AS e
           WHERE e.project_id = {projectId:UUID}
             AND e.timestamp >= {from:DateTime64}
             AND e.timestamp < {toExclusive:DateTime64}
             AND event IN ('${RC_EXPIRATION}', '${RC_CANCELLATION}')
           GROUP BY reason
           ORDER BY count DESC`,
          params,
        ),
        this.clickhouse.query<RecentEventRow>(
          `SELECT
             insert_id,
             event,
             distinct_id,
             toString(timestamp) AS timestamp,
             ${PRODUCT_ID_EXPR} AS product_id,
             ${PRICE_EXPR} AS price
           FROM events AS e
           WHERE e.project_id = {projectId:UUID}
             AND e.timestamp >= {from:DateTime64}
             AND e.timestamp < {toExclusive:DateTime64}
             AND event LIKE '$rc\\_%'
             AND event != '${RC_LINK_EVENT}'
           ORDER BY timestamp DESC
           LIMIT ${RECENT_EVENTS_LIMIT}`,
          params,
        ),
      ]),
    ]);

    return {
      mrr_cents,
      active,
      in_trial,
      grace,
      new_subscriptions: Number(subsTrialsRows[0]?.subs ?? 0),
      churned: Number(churnedRows[0]?.churned ?? 0),
      trials_started: Number(subsTrialsRows[0]?.trials ?? 0),
      trials_converted: Number(convertedRows[0]?.converted ?? 0),
      by_day: byDayRows.map((row) => ({
        t: row.t,
        new_subscriptions: Number(row.new_subscriptions),
        churned: Number(row.churned),
        revenue: Number(row.revenue),
      })),
      by_product,
      by_store,
      churn_reasons: churnReasonRows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
      recent_events: recentEventRows.map((row) => ({
        insert_id: row.insert_id,
        event: row.event,
        distinct_id: row.distinct_id,
        timestamp: row.timestamp,
        product_id: row.product_id,
        price: Number(row.price),
      })),
    };
  }

  /** Current-state KPIs from `SubscriptionState` — unfiltered, not date-scoped. */
  private async getStateKpis(projectId: string): Promise<{
    active: number;
    in_trial: number;
    grace: number;
    mrr_cents: number;
    by_product: Array<{ product_id: string; active: number; mrr_cents: number }>;
    by_store: Array<{ store: string; active: number }>;
  }> {
    const [statusRows, productRows, storeRows] = await Promise.all([
      this.prisma.subscriptionState.groupBy({
        by: ['status'],
        where: { projectId },
        _count: { _all: true },
        _sum: { mrrCents: true },
      }),
      this.prisma.subscriptionState.groupBy({
        by: ['productId'],
        where: { projectId, status: 'active' },
        _count: { _all: true },
        _sum: { mrrCents: true },
      }),
      this.prisma.subscriptionState.groupBy({
        by: ['store'],
        where: { projectId, status: 'active' },
        _count: { _all: true },
      }),
    ]);

    const activeRow = statusRows.find((row) => row.status === 'active');
    const trialRow = statusRows.find((row) => row.status === 'trial');
    const graceRow = statusRows.find((row) => row.status === 'grace');

    return {
      active: activeRow?._count._all ?? 0,
      in_trial: trialRow?._count._all ?? 0,
      grace: graceRow?._count._all ?? 0,
      mrr_cents: activeRow?._sum.mrrCents ?? 0,
      by_product: productRows
        .filter((row): row is typeof row & { productId: string } => row.productId !== null)
        .map((row) => ({
          product_id: row.productId,
          active: row._count._all,
          mrr_cents: row._sum.mrrCents ?? 0,
        })),
      by_store: storeRows
        .filter((row): row is typeof row & { store: string } => row.store !== null)
        .map((row) => ({ store: row.store, active: row._count._all })),
    };
  }
}
