import { Injectable } from '@nestjs/common';
import { ClickHouseService, toChDateTime64 } from '../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from '../analytics/bucket-grid';
import { compileFilterClauses } from '../analytics/filter-compiler';
import { canonicalization, CANONICAL_JOIN_SETTINGS } from '../analytics/identity';
import { parseFiltersParam, resolveDateOnlyRange } from '../analytics/read-query.util';
import { ProblemException } from '../common/problem-details';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

const RC_INITIAL = '$rc_initial_purchase';
const RC_RENEWAL = '$rc_renewal';
const RC_EXPIRATION = '$rc_expiration';
const RC_CANCELLATION = '$rc_cancellation';
const RC_NON_RENEWING = '$rc_non_renewing_purchase';
// `$rc_link` is an SDK identity event (re-emitted on every identify() when a RevenueCat link is
// set), not a subscription lifecycle event — excluded from the `$rc_%` lifecycle scans below.
const RC_LINK_EVENT = '$rc_link';
const PRICE_EXPR = "JSONExtractFloat(toJSONString(properties), '$price')";
const PERIOD_EXPR = "JSONExtractString(toJSONString(properties), '$rc_period_type')";
const PRODUCT_ID_EXPR = "JSONExtractString(toJSONString(properties), '$product_id')";
const EXPIRATION_REASON_EXPR = "JSONExtractString(toJSONString(properties), '$rc_expiration_reason')";
const CANCEL_REASON_EXPR = "JSONExtractString(toJSONString(properties), '$rc_cancel_reason')";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECENT_EVENTS_LIMIT = 20;

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

export interface SubscriptionAttributionResponse {
  drivers: Array<{ event: string; users: number }>;
  screens: Array<{ screen_name: string; users: number }>;
  time_to_convert: Array<{ bucket: string; users: number }>;
  trial_funnel: { trials: number; converted: number };
}

interface DriverRow {
  event: string;
  users: string | number;
}

interface ScreenRow {
  screen_name: string;
  users: string | number;
}

interface TimeToConvertRow {
  bucket: string;
  users: string | number;
}

interface TrialFunnelRow {
  trials: string | number;
  converted: string | number;
}

/** Fixed display order for `time_to_convert` buckets — CH's `GROUP BY bucket` has no guaranteed order. */
const TIME_TO_CONVERT_BUCKET_ORDER = ['<1d', '1-3d', '3-7d', '7-14d', '14-30d', '30d+'];

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
export class RcMetricsService {
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

  /**
   * `GET /metrics/subscriptions/attribution` (Subscriptions page). Conversion drivers/screens look
   * at the 7 days of activity immediately before each user's first `$rc_initial_purchase`;
   * time-to-convert buckets the gap between first-ever-seen and first purchase; the trial funnel
   * counts TRIAL initial purchases in range against later `$rc_renewal`. No `filters` param — same
   * as the lifecycle KPIs in `getSummary`, this is a fixed cohort definition, not a filtered query.
   */
  async getAttribution(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<SubscriptionAttributionResponse> {
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
    const params: Record<string, unknown> = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
    };

    // §17 identity-correct cohort: pre-identify (anonymous) events carry the anon distinct_id, so
    // first_purchase/first_seen and the outer drivers/screens scans all group and join on the
    // canonical uid — an anon→identified user's pre-purchase activity is one merged timeline.
    const canon = canonicalization('e.distinct_id');
    const firstPurchaseCte = `
      first_purchase AS (
        SELECT ${canon.uid} AS uid, min(e.timestamp) AS fp
        FROM events AS e
        ${canon.join}
        WHERE e.project_id = {projectId:UUID} AND e.event = '${RC_INITIAL}'
          AND e.timestamp >= {from:DateTime64} AND e.timestamp < {toExclusive:DateTime64}
        GROUP BY uid
      )`;

    const [driverRows, screenRows, timeToConvertRows, trialFunnelRows] = await Promise.all([
      this.clickhouse.query<DriverRow>(
        `WITH ${canon.cte}, ${firstPurchaseCte}
         SELECT e.event AS event, uniqExact(${canon.uid}) AS users
         FROM events AS e
         ${canon.join}
         INNER JOIN first_purchase AS f ON ${canon.uid} = f.uid
         WHERE e.project_id = {projectId:UUID}
           AND e.timestamp < f.fp AND e.timestamp >= f.fp - INTERVAL 7 DAY
           AND e.event NOT LIKE '$rc%'
         GROUP BY e.event ORDER BY users DESC LIMIT 20`,
        params,
        canon.settings,
      ),
      this.clickhouse.query<ScreenRow>(
        `WITH ${canon.cte}, ${firstPurchaseCte}
         SELECT JSONExtractString(toJSONString(e.properties), '$screen_name') AS screen_name,
                uniqExact(${canon.uid}) AS users
         FROM events AS e
         ${canon.join}
         INNER JOIN first_purchase AS f ON ${canon.uid} = f.uid
         WHERE e.project_id = {projectId:UUID}
           AND e.timestamp < f.fp AND e.timestamp >= f.fp - INTERVAL 7 DAY
           AND e.event = '$screen_view'
         GROUP BY screen_name
         HAVING screen_name != ''
         ORDER BY users DESC LIMIT 20`,
        params,
        canon.settings,
      ),
      this.clickhouse.query<TimeToConvertRow>(
        `WITH ${canon.cte}, ${firstPurchaseCte},
         first_seen AS (
           SELECT ${canon.uid} AS uid, min(e.timestamp) AS fs
           FROM events AS e
           ${canon.join}
           WHERE e.project_id = {projectId:UUID}
           GROUP BY uid
         )
         SELECT multiIf(secs < 86400, '<1d', secs < 259200, '1-3d', secs < 604800, '3-7d',
                         secs < 1209600, '7-14d', secs < 2592000, '14-30d', '30d+') AS bucket,
                count() AS users
         FROM (
           -- Elapsed seconds, not calendar-day truncation, so a purchase 20h after first-seen
           -- buckets as '<1d' instead of being rounded to a whole calendar day.
           SELECT dateDiff('second', s.fs, f.fp) AS secs
           FROM first_purchase AS f INNER JOIN first_seen AS s ON f.uid = s.uid
         )
         GROUP BY bucket`,
        params,
        canon.settings,
      ),
      this.clickhouse.query<TrialFunnelRow>(
        `WITH trial_starts AS (
           -- min(timestamp) per user: if a user somehow has multiple trials in range, conversion is
           -- measured from the earliest one.
           SELECT distinct_id, min(timestamp) AS trial_ts
           FROM events
           WHERE project_id = {projectId:UUID} AND event = '${RC_INITIAL}'
             AND ${PERIOD_EXPR} = 'TRIAL'
             AND timestamp >= {from:DateTime64} AND timestamp < {toExclusive:DateTime64}
           GROUP BY distinct_id
         ),
         renewals AS (
           SELECT distinct_id, min(timestamp) AS first_renewal
           FROM events
           WHERE project_id = {projectId:UUID} AND event = '${RC_RENEWAL}'
           GROUP BY distinct_id
         )
         SELECT count() AS trials,
                -- join_use_nulls=1 (CANONICAL_JOIN_SETTINGS) makes r.first_renewal NULL, not
                -- epoch-zero, for non-renewed users, so NULL > trial_ts is NULL and countIf
                -- correctly skips them instead of counting a false conversion.
                countIf(r.first_renewal > t.trial_ts) AS converted
         FROM trial_starts AS t
         LEFT JOIN renewals AS r ON t.distinct_id = r.distinct_id`,
        params,
        CANONICAL_JOIN_SETTINGS,
      ),
    ]);

    const usersByBucket = new Map(timeToConvertRows.map((row) => [row.bucket, Number(row.users)]));

    return {
      drivers: driverRows.map((row) => ({ event: row.event, users: Number(row.users) })),
      screens: screenRows.map((row) => ({ screen_name: row.screen_name, users: Number(row.users) })),
      time_to_convert: TIME_TO_CONVERT_BUCKET_ORDER.filter((bucket) => usersByBucket.has(bucket)).map(
        (bucket) => ({ bucket, users: usersByBucket.get(bucket)! }),
      ),
      trial_funnel: {
        trials: Number(trialFunnelRows[0]?.trials ?? 0),
        converted: Number(trialFunnelRows[0]?.converted ?? 0),
      },
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
