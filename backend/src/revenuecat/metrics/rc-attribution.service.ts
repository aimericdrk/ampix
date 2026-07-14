import { Injectable } from '@nestjs/common';
import { ClickHouseService, toChDateTime64 } from '../../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from '../../analytics/support/bucket-grid';
import { canonicalization, CANONICAL_JOIN_SETTINGS } from '../../analytics/support/identity';
import { resolveDateOnlyRange } from '../../analytics/support/read-query.util';
import { ProblemException } from '../../common/problem-details';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/core/projects.service';
import {
  MS_PER_DAY,
  PERIOD_EXPR,
  RC_INITIAL,
  RC_RENEWAL,
  TIME_TO_CONVERT_BUCKET_ORDER,
} from './rc-metrics.constants';

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

/**
 * `GET /metrics/subscriptions/attribution` (Subscriptions page). Conversion drivers/screens look
 * at the 7 days of activity immediately before each user's first `$rc_initial_purchase`;
 * time-to-convert buckets the gap between first-ever-seen and first purchase; the trial funnel
 * counts TRIAL initial purchases in range against later `$rc_renewal`. No `filters` param — same
 * as the lifecycle KPIs in `getSummary`, this is a fixed cohort definition, not a filtered query.
 */
@Injectable()
export class RcAttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

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
}
