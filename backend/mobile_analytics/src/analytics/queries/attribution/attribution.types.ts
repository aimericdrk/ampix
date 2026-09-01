/**
 * `GET /metrics/attribution` — where the accounts created in a window came from.
 *
 * Two populations, reported side by side for every source, because in a mobile app they are not the
 * same people and the gap between them is the number that matters:
 *
 *  - `installs` — users whose FIRST-EVER event in the project falls in the window. Everyone who
 *    opened the app, including the ones who never signed up.
 *  - `signups`  — users whose first `$identify` falls in the window: the moment an anonymous
 *    install became an account (contracts §4/§17).
 *
 * `signup_rate` is `signups / installs` over the SAME source, so a campaign that drives a lot of
 * curious installs and few accounts is visible next to one that drives fewer, better ones. It is
 * `null`, not 0, when a source has no installs in the window — sources whose signups arrived from
 * installs made BEFORE the window are real, and reporting an infinite/undefined rate as 0% would
 * misread them as the worst-performing source rather than an out-of-window one.
 */

/** One row of an attribution breakdown — a first-touch source, campaign, medium or referrer. */
export interface AttributionBreakdownRow {
  /** The dimension value; '' is reported as `null` and rendered as "Direct / unknown". */
  value: string | null;
  installs: number;
  signups: number;
  /** `signups / installs`, or null when `installs` is 0 (see the note above). */
  signup_rate: number | null;
}

/** The attribution of one account, as captured on that user's first-ever event. */
export interface AttributedAccount {
  distinct_id: string;
  /** First-ever event for this canonical user — when the account was "created" as an install. */
  first_seen: string;
  /** First `$identify`; null for a user who has never signed up. */
  signed_up_at: string | null;
  name: string | null;
  email: string | null;
  /** First-touch attribution (the SDK's `first_utm_*`, never overwritten after the first touch). */
  first_utm_source: string | null;
  first_utm_campaign: string | null;
  /** Last-touch attribution seen on that same first event. */
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  /** Android Play Store install referrer string, when the SDK captured one. */
  install_referrer: string | null;
}

export interface AttributionResponse {
  /** Distinct users whose first-ever event is in the window. */
  total_installs: number;
  /** Distinct users whose first `$identify` is in the window. */
  total_signups: number;
  /** `total_signups / total_installs`; null when there were no installs (see the note above). */
  signup_rate: number | null;
  by_source: AttributionBreakdownRow[];
  by_campaign: AttributionBreakdownRow[];
  by_medium: AttributionBreakdownRow[];
  by_referrer: AttributionBreakdownRow[];
  /** The most recent accounts created in the window, newest first. */
  accounts: AttributedAccount[];
}
