import { Injectable } from '@nestjs/common';
import { ClickHouseService, toChDateTime64 } from '../../clickhouse/clickhouse.service';
import { parseDateOnlyUTC } from '../support/bucket-grid';
import { CANONICAL_JOIN_SETTINGS } from '../support/identity';
import { resolveDateOnlyRange } from '../support/read-query.util';
import { ProjectsService } from '../../projects/core/projects.service';
import { MS_PER_DAY } from '../../revenuecat/metrics/rc-metrics.constants';
import {
  EXCLUDED_EVENT_PREFIX,
  daysToOutcomeSql,
  frequencySql,
  outcomeSpec,
  pathSql,
  productsSql,
  screensSql,
  summarySql,
  type OutcomeSpec,
} from './journey.sql';
import type {
  JourneyFrequencyRow,
  JourneyOutcome,
  JourneyPathStep,
  JourneyProductRow,
  JourneyQuantiles,
  JourneyResponse,
  JourneySummaryMetric,
} from './journey.types';

export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 30;
export const DEFAULT_PATH_STEPS = 8;
export const MAX_PATH_STEPS = 20;
/** How many rows the frequency/screens blocks return. Ranked by the cohort's own per-user rate, so
 *  the cut keeps what the cohort actually does rather than what is globally popular. */
const FREQUENCY_LIMIT = 25;

interface SummaryRow {
  grp: string;
  users: string | number;
  steps_p25: string | number;
  steps_p50: string | number;
  steps_p75: string | number;
  sessions_p25: string | number;
  sessions_p50: string | number;
  sessions_p75: string | number;
  names_p25: string | number;
  names_p50: string | number;
  names_p75: string | number;
}

interface DaysRow {
  p25: string | number;
  p50: string | number;
  p75: string | number;
  users: string | number;
}

interface PathRow {
  steps_before_outcome: string | number;
  event: string;
  screen_name: string;
  users: string | number;
  median_seconds_to_outcome: string | number;
}

interface FrequencyRow {
  grp: string;
  name: string;
  occurrences: string | number;
  users: string | number;
}

interface ProductRow {
  product_id: string;
  period_type: string;
  users: string | number;
}

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

/** Rounds to `digits` decimals so a rate reads as 2.43, not 2.4299999999999997 — the payload is
 *  read by a model as text, and float noise is tokens that carry no information. */
const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** cohort ÷ control, or `null` when the ratio is undefined. An undefined ratio is reported as
 *  absent rather than as Infinity or a fabricated ceiling — the consumer is told "no comparison",
 *  not given a number it might quote. */
function lift(cohort: number, control: number): number | null {
  if (control === 0) return null;
  return round(cohort / control);
}

function quantiles(p25: number, p50: number, p75: number): JourneyQuantiles {
  return { p25: round(p25, 2), median: round(p50, 2), p75: round(p75, 2) };
}

/**
 * `GET /metrics/subscriptions/journey` — what users do in the run-up to subscribing, renewing or
 * being refunded, measured against a control cohort that did not.
 *
 * This reads the EVENT STREAM and nothing else. RevenueCat's official webhook writes
 * `$rc_initial_purchase` / `$rc_renewal` / `$rc_cancellation` / `$rc_expiration` into `events` like
 * any other event, so the analysis needs no `revenueCatIntegration` row, no Postgres subscription
 * state, and no part of the MyRevenueCat clone being configured — which is exactly why it lives
 * under analytics rather than beside the clone. A project with no RevenueCat events yet gets an
 * empty report, not a 404: nothing has happened, which is a different thing from being unavailable.
 *
 * The comparison is the point. "Users viewed the paywall 2.4 times before subscribing" is not a
 * finding on its own; it becomes one only next to what everyone else did. So every block here is
 * computed for both groups off one window scan, and the response ships the cohort sizes and the
 * plain-language cohort definitions beside the numbers — the second reader of this payload is a
 * language model (`/journey/analyze`, or an external agent fetching the endpoint directly), which
 * has no other way to learn what was measured.
 *
 * Unlike `RcSummaryService` this takes no `filters`: the cohort IS the filter, and layering the
 * global filter bar on top of it would make "the control" mean something different on every page
 * load.
 */
@Injectable()
export class JourneyService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly projects: ProjectsService,
  ) {}

  async getJourney(
    userId: string,
    projectId: string,
    outcome: JourneyOutcome,
    fromRaw?: string,
    toRaw?: string,
    windowDaysRaw?: number,
    pathStepsRaw?: number,
  ): Promise<JourneyResponse> {
    await this.projects.assertMembership(userId, projectId);

    const { from, to } = resolveDateOnlyRange(fromRaw, toRaw);
    const windowDays = clamp(windowDaysRaw ?? DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
    const pathSteps = clamp(pathStepsRaw ?? DEFAULT_PATH_STEPS, 3, MAX_PATH_STEPS);
    const spec = outcomeSpec(outcome);

    const params: Record<string, unknown> = {
      projectId,
      from: toChDateTime64(parseDateOnlyUTC(from)),
      toExclusive: toChDateTime64(parseDateOnlyUTC(to) + MS_PER_DAY),
      windowDays,
      pathSteps,
    };

    const [summaryRows, daysRows, pathRows, frequencyRows, screenRows, productRows] =
      await Promise.all([
        this.clickhouse.query<SummaryRow>(summarySql(spec), params, CANONICAL_JOIN_SETTINGS),
        this.clickhouse.query<DaysRow>(daysToOutcomeSql(spec), params, CANONICAL_JOIN_SETTINGS),
        this.clickhouse.query<PathRow>(pathSql(spec), params, CANONICAL_JOIN_SETTINGS),
        this.clickhouse.query<FrequencyRow>(frequencySql(spec), params, CANONICAL_JOIN_SETTINGS),
        this.clickhouse.query<FrequencyRow>(screensSql(spec), params, CANONICAL_JOIN_SETTINGS),
        this.clickhouse.query<ProductRow>(productsSql(spec), params, CANONICAL_JOIN_SETTINGS),
      ]);

    const cohortRow = summaryRows.find((row) => row.grp === 'cohort');
    const controlRow = summaryRows.find((row) => row.grp === 'control');
    const cohortUsers = num(cohortRow?.users);
    const controlUsers = num(controlRow?.users);

    return {
      definition: {
        outcome,
        outcome_events: spec.events,
        outcome_criteria: spec.outcomeCriteria,
        control_criteria: spec.controlCriteria,
        window_days: windowDays,
        path_steps: pathSteps,
        excluded_event_prefix: EXCLUDED_EVENT_PREFIX,
        date_range: { from, to },
        generated_at: new Date().toISOString(),
      },
      cohort: { users: cohortUsers },
      control: { users: controlUsers },
      summary: buildSummary(spec, cohortRow, controlRow, daysRows[0]),
      path: buildPath(pathRows, cohortUsers),
      frequency: buildFrequency(frequencyRows, cohortUsers, controlUsers),
      screens: buildFrequency(screenRows, cohortUsers, controlUsers),
      products: buildProducts(productRows, cohortUsers),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function buildSummary(
  spec: OutcomeSpec,
  cohort: SummaryRow | undefined,
  control: SummaryRow | undefined,
  days: DaysRow | undefined,
): JourneySummaryMetric[] {
  const pair = (
    metric: JourneySummaryMetric['metric'],
    unit: JourneySummaryMetric['unit'],
    definition: string,
    keys: [keyof SummaryRow, keyof SummaryRow, keyof SummaryRow],
  ): JourneySummaryMetric => {
    const cohortQ = cohort
      ? quantiles(num(cohort[keys[0]]), num(cohort[keys[1]]), num(cohort[keys[2]]))
      : null;
    const controlQ = control
      ? quantiles(num(control[keys[0]]), num(control[keys[1]]), num(control[keys[2]]))
      : null;
    return {
      metric,
      unit,
      definition,
      cohort: cohortQ,
      control: controlQ,
      lift: cohortQ && controlQ ? lift(cohortQ.median, controlQ.median) : null,
    };
  };

  const metrics: JourneySummaryMetric[] = [
    pair(
      'steps_before',
      'events',
      'Events recorded in the window before the anchor, whoever wrote them — a backend-emitted ' +
        'event counts here, because it is a thing that happened to this person before the outcome.',
      ['steps_p25', 'steps_p50', 'steps_p75'],
    ),
    pair(
      'sessions_before',
      'sessions',
      'Distinct session ids in the window before the anchor. Read this one against the event ' +
        'count: a session is a device concept, and a server-written event carries whatever ' +
        'session id its caller sent — often a fresh one per event, in which case this tracks the ' +
        'event count rather than real app sessions.',
      ['sessions_p25', 'sessions_p50', 'sessions_p75'],
    ),
    pair(
      'distinct_events_before',
      'event_names',
      'Distinct event names in the window before the anchor — how much of the app they touched.',
      ['names_p25', 'names_p50', 'names_p75'],
    ),
  ];

  // Only the cohort has an outcome to measure to, so this metric has no control side at all —
  // reported as `control: null` rather than as a zero, which would read as "they took no time".
  metrics.push({
    metric: 'days_to_outcome',
    unit: 'days',
    definition: spec.daysToOutcomeDefinition,
    cohort:
      days && num(days.users) > 0 ? quantiles(num(days.p25), num(days.p50), num(days.p75)) : null,
    control: null,
    lift: null,
  });

  return metrics;
}

/** Keeps the modal (most common) event per position. Rows arrive ordered by position then user
 *  count, so the first row seen for a position is its winner. */
function buildPath(rows: PathRow[], cohortUsers: number): JourneyPathStep[] {
  const byPosition = new Map<number, JourneyPathStep>();
  for (const row of rows) {
    const position = num(row.steps_before_outcome);
    if (byPosition.has(position)) continue;
    const users = num(row.users);
    byPosition.set(position, {
      steps_before_outcome: position,
      event: row.event,
      screen_name: row.screen_name === '' ? null : row.screen_name,
      users,
      share: cohortUsers > 0 ? round(users / cohortUsers) : 0,
      median_seconds_to_outcome: Math.round(num(row.median_seconds_to_outcome)),
    });
  }
  // Oldest first, so the list reads in the order the user actually moved through it.
  return [...byPosition.values()].sort(
    (a, b) => b.steps_before_outcome - a.steps_before_outcome,
  );
}

function buildFrequency(
  rows: FrequencyRow[],
  cohortUsers: number,
  controlUsers: number,
): JourneyFrequencyRow[] {
  interface Side {
    occurrences: number;
    users: number;
  }
  const merged = new Map<string, { cohort: Side; control: Side }>();
  for (const row of rows) {
    const entry = merged.get(row.name) ?? {
      cohort: { occurrences: 0, users: 0 },
      control: { occurrences: 0, users: 0 },
    };
    const side = row.grp === 'cohort' ? entry.cohort : entry.control;
    side.occurrences = num(row.occurrences);
    side.users = num(row.users);
    merged.set(row.name, entry);
  }

  const perUser = (side: Side, groupUsers: number) =>
    groupUsers > 0 ? round(side.occurrences / groupUsers) : 0;
  const share = (side: Side, groupUsers: number) =>
    groupUsers > 0 ? round(side.users / groupUsers) : 0;

  return [...merged.entries()]
    .map(([name, entry]) => {
      const cohortPerUser = perUser(entry.cohort, cohortUsers);
      const controlPerUser = perUser(entry.control, controlUsers);
      return {
        name,
        cohort_per_user: cohortPerUser,
        control_per_user: controlPerUser,
        cohort_user_share: share(entry.cohort, cohortUsers),
        control_user_share: share(entry.control, controlUsers),
        lift: lift(cohortPerUser, controlPerUser),
      };
    })
    .sort((a, b) => b.cohort_per_user - a.cohort_per_user)
    .slice(0, FREQUENCY_LIMIT);
}

/** An absent `$product_id` becomes `null`, never the empty string: "the webhook sent no product"
 *  and "the product is named ''" are different facts, and only one of them is real. */
function buildProducts(rows: ProductRow[], cohortUsers: number): JourneyProductRow[] {
  return rows.map((row) => {
    const users = num(row.users);
    return {
      product_id: row.product_id === '' ? null : row.product_id,
      period_type: row.period_type === '' ? null : row.period_type,
      users,
      share: cohortUsers > 0 ? round(users / cohortUsers) : 0,
    };
  });
}
