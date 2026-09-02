import { Inject, Injectable } from '@nestjs/common';
import { ClickHouseService, fromChDateTime64, toChDateTime64 } from '../../../clickhouse/clickhouse.service';
import { ProjectsService } from '../../../projects/core/projects.service';
import { parseDateOnlyUTC } from '../../support/bucket-grid';
import { canonicalization } from '../../support/identity';
import { EVENT_SOURCE_EXPR } from '../../support/property-resolver';
import { resolveDateOnlyRange } from '../../support/read-query.util';
import type { HiddenUserSource } from '../../services/analytics.shared';
import { UserAdminService } from '../../services/user-admin.service';
import type {
  AttributedAccount,
  AttributionBreakdownRow,
  AttributionResponse,
} from './attribution.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The reserved event that marks an anonymous install becoming an account (contracts §4/§17). */
const IDENTIFY_EVENT = '$identify';

/** §6.1.1: the token kind an SDK on a device writes with. Attribution reads nothing else. */
const CLIENT_SOURCE = 'client';

/** How many recent accounts the response lists. Bounded — this is a "who signed up lately" panel,
 *  not an export; the breakdowns above it cover the whole window. */
const ACCOUNTS_LIMIT = 200;

/** How many values one breakdown reports. Beyond this the tail is long-tail noise (one install per
 *  malformed referrer string), and the chart cannot show it legibly anyway. */
const MAX_BREAKDOWN_VALUES = 50;

/**
 * The four first-touch dimensions the page breaks down by. Keys are OUR OWN fixed `analytics.events`
 * column identifiers (contracts §5) — never caller input — so embedding them in the SQL text carries
 * no injection risk, exactly like `property-resolver.ts`'s whitelist branch.
 *
 * `first_utm_source`/`first_utm_campaign` are the SDK's FIRST-touch values (written once and never
 * overwritten), which is what "where did this account come from" means. `utm_medium` has no
 * first-touch twin in the schema, so the medium breakdown reads the last-touch column as recorded
 * on the user's first event — which, for a user whose first event IS their first touch, is the same
 * value.
 */
const BREAKDOWN_COLUMNS = Object.freeze({
  source: 'first_utm_source',
  campaign: 'first_utm_campaign',
  medium: 'utm_medium',
  referrer: 'install_referrer',
} as const);

type BreakdownKey = keyof typeof BREAKDOWN_COLUMNS;

/**
 * `argMinIf(e.<column>, e.timestamp, e.<column> != '') AS <column>` — the value from the EARLIEST
 * event that actually carried one. `column` is always one of OUR OWN fixed `analytics.events`
 * identifiers (the CTE below passes literals), never caller input, so embedding it in the SQL text
 * carries no injection risk.
 */
function earliestNonEmpty(column: string): string {
  return `argMinIf(e.${column}, e.timestamp, e.${column} != '') AS ${column}`;
}

interface BreakdownRow {
  value: string;
  installs: string | number;
  signups: string | number;
}

interface AccountRow {
  distinct_id: string;
  first_seen: string;
  signed_up_at: string;
  has_signup: number | string;
  name: string;
  email: string;
  first_utm_source: string;
  first_utm_campaign: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  install_referrer: string;
}

interface TotalsRow {
  installs: string | number;
  signups: string | number;
}

/**
 * `GET /metrics/attribution` — the acquisition readout for accounts created in a window.
 *
 * The whole query rests on one CTE, `first_touch`: per CANONICAL user (§17, so an anon→identified
 * person is ONE account, attributed to the campaign that brought their anonymous install in — not
 * to whatever they had in hand on the day they logged in), the timestamp of their first-ever event,
 * the timestamp of their first `$identify`, and their attribution columns.
 *
 * The EARLIEST NON-EMPTY value, not simply the value on the earliest event. `first_utm_source` and
 * friends are written once by the SDK and never overwritten, so any non-empty occurrence is the
 * same first touch — but it does not always ride on the very first event (an install referrer or a
 * deep link resolves a moment after the app's first `$app_open`). A plain `argMin` read those
 * users' attribution as empty and filed a real campaign under Direct / unknown. Never the LATEST
 * value, which would re-attribute a user to whatever campaign they most recently clicked.
 *
 * The install/signup windows are evaluated over that per-user CTE rather than over raw events, so a
 * user is counted once, in the window their account was created — never once per event and never
 * once per day.
 *
 * CLIENT EVENTS ONLY. An install, and the campaign behind it, are facts about a DEVICE: they are
 * carried on the events an SDK sends. A backend writing about a person is neither. Counting server
 * rows here did two things, both wrong. It invented installs — every user id a backend ever
 * mentioned (a like received, a message, a RevenueCat webhook) became an install on the day the
 * backend first wrote about them, landing in the unattributed bucket. And because a server row
 * carries no utm/referrer columns and typically lands BEFORE the device reports the same moment,
 * `argMin` picked it as the first touch and re-labelled a genuinely attributed install as
 * Direct / unknown.
 *
 * The trade-off, stated plainly: a backend that posts real utm data with a server token would no
 * longer be attributed. That is not a loss today — server-written rows carry no attribution
 * columns at all — and it is the right default, because "where did this install come from" is a
 * question about a device.
 */
@Injectable()
export class AttributionService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
    /**
     * Typed as the narrow {@link HiddenUserSource} interface so this read path never reaches the
     * hide/erase write surface — which is exactly why it needs an explicit `@Inject` token: an
     * interface is erased at runtime, leaving Nest nothing to resolve. Same wiring as UsersService.
     */
    @Inject(UserAdminService) private readonly hidden: HiddenUserSource,
  ) {}

  async getAttribution(
    userId: string,
    projectId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<AttributionResponse> {
    await this.projects.assertMembership(userId, projectId);

    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);
    const hiddenIds = await this.hidden.hiddenIds(projectId);

    const canon = canonicalization();
    const params: Record<string, unknown> = {
      projectId,
      identifyEvent: IDENTIFY_EVENT,
      // Bound like `identifyEvent` rather than embedded: same doctrine, and it keeps the one place
      // this query decides "a device did this" visible in the params.
      clientSource: CLIENT_SOURCE,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
      accountsLimit: ACCOUNTS_LIMIT,
    };
    // Hidden users are excluded from the acquisition numbers for the same reason they leave the
    // Users list: they are test accounts and staff devices, and counting them would overstate every
    // campaign they happen to be attributed to.
    let hiddenClause = '';
    if (hiddenIds.length > 0) {
      params.hiddenIds = hiddenIds;
      hiddenClause = '\n        HAVING uid NOT IN {hiddenIds:Array(String)}';
    }

    const firstTouchCte = `first_touch AS (
        SELECT
          ${canon.uid} AS uid,
          min(e.timestamp) AS first_seen,
          -- minIf over zero matching rows returns the epoch default for a non-Nullable column, so
          -- has_signup (not the timestamp) is what decides whether this user ever signed up.
          minIf(e.timestamp, e.event = {identifyEvent:String}) AS signed_up_at,
          maxIf(1, e.event = {identifyEvent:String}) AS has_signup,
          ${earliestNonEmpty('first_utm_source')},
          ${earliestNonEmpty('first_utm_campaign')},
          ${earliestNonEmpty('utm_source')},
          ${earliestNonEmpty('utm_medium')},
          ${earliestNonEmpty('utm_campaign')},
          ${earliestNonEmpty('install_referrer')}
        FROM events AS e
        ${canon.join}
        WHERE e.project_id = {projectId:UUID}
          AND ${EVENT_SOURCE_EXPR} = {clientSource:String}
        GROUP BY uid${hiddenClause}
      )`;

    // "Created in this window" for each population. An install lands in the window when the user's
    // first-ever event does; a signup when their first $identify does. A user can contribute to
    // both, to one, or (for an install made earlier that signed up now) only to signups.
    const inInstallWindow = 'first_seen >= {from:DateTime64} AND first_seen < {toExclusive:DateTime64}';
    const inSignupWindow = `has_signup = 1 AND signed_up_at >= {from:DateTime64} AND signed_up_at < {toExclusive:DateTime64}`;

    const breakdownKeys = Object.keys(BREAKDOWN_COLUMNS) as BreakdownKey[];

    const totalsQuery = this.clickhouse.query<TotalsRow>(
      `WITH ${canon.cte}, ${firstTouchCte}
       SELECT countIf(${inInstallWindow}) AS installs,
              countIf(${inSignupWindow}) AS signups
       FROM first_touch`,
      params,
      canon.settings,
    );

    const breakdownQueries = breakdownKeys.map((key) =>
      this.clickhouse.query<BreakdownRow>(
        `WITH ${canon.cte}, ${firstTouchCte}
         SELECT ${BREAKDOWN_COLUMNS[key]} AS value,
                countIf(${inInstallWindow}) AS installs,
                countIf(${inSignupWindow}) AS signups
         FROM first_touch
         WHERE (${inInstallWindow}) OR (${inSignupWindow})
         GROUP BY value
         ORDER BY installs DESC, signups DESC
         LIMIT ${MAX_BREAKDOWN_VALUES}`,
        params,
        canon.settings,
      ),
    );

    const accountsQuery = this.clickhouse.query<AccountRow>(
      `WITH ${canon.cte}, ${firstTouchCte}
       SELECT f.uid AS distinct_id, f.first_seen AS first_seen, f.signed_up_at AS signed_up_at,
              f.has_signup AS has_signup,
              JSONExtractString(toJSONString(up.properties), 'name') AS name,
              JSONExtractString(toJSONString(up.properties), 'email') AS email,
              f.first_utm_source AS first_utm_source, f.first_utm_campaign AS first_utm_campaign,
              f.utm_source AS utm_source, f.utm_medium AS utm_medium,
              f.utm_campaign AS utm_campaign, f.install_referrer AS install_referrer
       FROM first_touch AS f
       LEFT JOIN (
         SELECT distinct_id, properties FROM user_profiles FINAL WHERE project_id = {projectId:UUID}
       ) AS up ON up.distinct_id = f.uid
       WHERE (${inInstallWindow}) OR (${inSignupWindow})
       ORDER BY f.first_seen DESC
       LIMIT {accountsLimit:UInt64}`,
      params,
      canon.settings,
    );

    const [totalsRows, breakdownRows, accountRows] = await Promise.all([
      totalsQuery,
      Promise.all(breakdownQueries),
      accountsQuery,
    ]);

    const totalInstalls = Number(totalsRows[0]?.installs ?? 0);
    const totalSignups = Number(totalsRows[0]?.signups ?? 0);

    const byKey = Object.fromEntries(
      breakdownKeys.map((key, index) => [key, toBreakdownRows(breakdownRows[index] ?? [])]),
    ) as Record<BreakdownKey, AttributionBreakdownRow[]>;

    return {
      total_installs: totalInstalls,
      total_signups: totalSignups,
      signup_rate: rate(totalSignups, totalInstalls),
      by_source: byKey.source,
      by_campaign: byKey.campaign,
      by_medium: byKey.medium,
      by_referrer: byKey.referrer,
      accounts: accountRows.map(toAccount),
    };
  }
}

/** `signups / installs`, or null when there is nothing to divide by (see attribution.types.ts). */
function rate(signups: number, installs: number): number | null {
  return installs > 0 ? signups / installs : null;
}

/** '' is the ClickHouse String default for "the SDK captured no value here" — reported as null so
 *  the UI can label it ("Direct / unknown") instead of rendering an empty cell. */
function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

function toBreakdownRows(rows: BreakdownRow[]): AttributionBreakdownRow[] {
  return rows.map((row) => {
    const installs = Number(row.installs);
    const signups = Number(row.signups);
    return {
      value: emptyToNull(row.value),
      installs,
      signups,
      signup_rate: rate(signups, installs),
    };
  });
}

function toAccount(row: AccountRow): AttributedAccount {
  return {
    distinct_id: row.distinct_id,
    first_seen: fromChDateTime64(row.first_seen),
    // Gate on `has_signup`, never on the timestamp: `minIf` over no matching rows yields the
    // epoch default for a non-Nullable DateTime64, which would read as a 1970 signup.
    signed_up_at: Number(row.has_signup) === 1 ? fromChDateTime64(row.signed_up_at) : null,
    name: emptyToNull(row.name),
    email: emptyToNull(row.email),
    first_utm_source: emptyToNull(row.first_utm_source),
    first_utm_campaign: emptyToNull(row.first_utm_campaign),
    utm_source: emptyToNull(row.utm_source),
    utm_medium: emptyToNull(row.utm_medium),
    utm_campaign: emptyToNull(row.utm_campaign),
    install_referrer: emptyToNull(row.install_referrer),
  };
}
