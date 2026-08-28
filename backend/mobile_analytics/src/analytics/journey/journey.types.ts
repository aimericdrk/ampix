/**
 * `GET /metrics/subscriptions/journey` — the pre-outcome behavioural report.
 *
 * The payload is deliberately SELF-DESCRIBING: every block carries its own units, cohort sizes and
 * a plain-language `definition`, because the second consumer of this endpoint is a language model
 * (either the in-product `/journey/analyze` call or an external agent fetching it directly). An
 * agent must be able to reason about these numbers without access to this file, so nothing here is
 * an unlabelled magic number — no bare ratios, no undocumented buckets, no implicit time units.
 */

/** Which outcome the journey is measured against — the three RevenueCat webhook moments that
 *  matter: they paid, they paid again, they got their money back. */
export type JourneyOutcome = 'subscribe' | 'renew' | 'refund';

/** Everything needed to interpret the report — the AI reads this before the numbers. */
export interface JourneyDefinition {
  outcome: JourneyOutcome;
  /** Reserved event names that mark the outcome. */
  outcome_events: string[];
  /** Plain-language statement of who is in the measured cohort. */
  outcome_criteria: string;
  /** Plain-language statement of who is in the comparison cohort, and what their window is
   *  anchored on — the control has no outcome event, so its window needs its own anchor. */
  control_criteria: string;
  /** How far back from each user's anchor the behavioural window reaches. */
  window_days: number;
  /** How many ordered steps before the outcome `path` reports. */
  path_steps: number;
  /** Reserved-name prefix excluded from `path`/`frequency`: subscription lifecycle events are the
   *  outcome family, not behaviour leading to it. */
  excluded_event_prefix: string;
  date_range: { from: string; to: string };
  generated_at: string;
}

/** A `p25 / median / p75` triple. `null` when the group has no users to summarise. */
export interface JourneyQuantiles {
  p25: number;
  median: number;
  p75: number;
}

/** One headline metric, cohort against control. */
export interface JourneySummaryMetric {
  metric: 'steps_before' | 'sessions_before' | 'distinct_events_before' | 'days_to_outcome';
  /** What the number counts, so an agent never has to infer the unit. */
  unit: 'events' | 'sessions' | 'event_names' | 'days';
  /** Plain-language statement of exactly what was measured. */
  definition: string;
  cohort: JourneyQuantiles | null;
  /** `null` for metrics that only exist for the cohort (`days_to_outcome` has no control anchor). */
  control: JourneyQuantiles | null;
  /** cohort median ÷ control median. `null` when either side is absent or the control median is 0
   *  (an undefined ratio is reported as absent, never as a fabricated large number). */
  lift: number | null;
}

/** One step of the reconstructed typical path. */
export interface JourneyPathStep {
  /** 1 = the step immediately before the outcome, 2 = the one before that, and so on. */
  steps_before_outcome: number;
  /** The most common event at this position across the cohort (the modal step). */
  event: string;
  /** Set only for `$screen_view`; a screen view of /pay is a different step from one of /home. */
  screen_name: string | null;
  /** Cohort users whose step at this position was this event. */
  users: number;
  /** `users` ÷ cohort users — how typical this step actually is. A low share means the cohort
   *  does NOT share a common path at this depth, which is itself the finding. */
  share: number;
  /** Median seconds from this step to the outcome event. Differencing consecutive steps gives the
   *  per-step gap; it is reported against the outcome so each figure stands on its own. */
  median_seconds_to_outcome: number;
}

/** Per-user frequency of one event (or one screen), cohort against control. */
export interface JourneyFrequencyRow {
  /** The event name, or the screen name for the `screens` block. */
  name: string;
  /** Mean occurrences per user in the window, counting users with zero occurrences. */
  cohort_per_user: number;
  control_per_user: number;
  /** Share of the group's users who did this at least once, in [0,1]. */
  cohort_user_share: number;
  control_user_share: number;
  /** cohort_per_user ÷ control_per_user, `null` when the control never did it (undefined ratio). */
  lift: number | null;
}

/** Which subscription the outcome was, off the webhook's own `$product_id`. */
export interface JourneyProductRow {
  /** RevenueCat's product identifier; `null` when the webhook carried none. */
  product_id: string | null;
  /** RevenueCat's `period_type` for that purchase — TRIAL, NORMAL, INTRO, …; `null` when absent. */
  period_type: string | null;
  users: number;
  /** `users` ÷ cohort users. */
  share: number;
}

export interface JourneyResponse {
  definition: JourneyDefinition;
  cohort: { users: number };
  control: { users: number };
  summary: JourneySummaryMetric[];
  /** Ordered oldest → newest; the last entry is `steps_before_outcome: 1`. */
  path: JourneyPathStep[];
  frequency: JourneyFrequencyRow[];
  screens: JourneyFrequencyRow[];
  /** Which subscription each cohort member's outcome event was for, most common first. */
  products: JourneyProductRow[];
}

/** One thing the model claims to have found, with the numbers it rests on. */
export interface JourneyFinding {
  title: string;
  detail: string;
  /** The specific figures from `report` the claim rests on, so a reader can check it without
   *  re-deriving the analysis. A finding that cites nothing is a finding that was made up. */
  evidence: string[];
}

/** `POST /metrics/subscriptions/journey/analyze` — the same report, read by the model. */
export interface JourneyAnalysisResponse {
  outcome: JourneyOutcome;
  /** One sentence: the single most important thing in the report. */
  headline: string;
  findings: JourneyFinding[];
  /** Where the data does not support a conclusion — thin cohorts, absent control, flat paths. */
  caveats: string[];
  /** The exact payload the model was given, so the narrative is auditable against its input. */
  report: JourneyResponse;
}
