/**
 * Promotional-entitlement grant durations (design §1.1). `lifetime` has no expiry; every other
 * duration computes `expiresAt` from `grantedAt` via UTC date math: `daily`/`three_day`/`weekly`
 * add whole UTC days, `monthly`/`two_month`/`three_month`/`six_month`/`yearly` add whole UTC
 * calendar months (JS `Date.UTC` month-overflow rolls forward, e.g. Jan 31 + 1 month -> Mar 3 —
 * plain calendar-month arithmetic, no end-of-month clamping).
 */
export const PROMOTIONAL_DURATIONS = [
  'daily',
  'three_day',
  'weekly',
  'monthly',
  'two_month',
  'three_month',
  'six_month',
  'yearly',
  'lifetime',
] as const;

export type PromotionalDuration = (typeof PROMOTIONAL_DURATIONS)[number];

/** Pure function: computes a promotional grant's `expiresAt` from `grantedAt` + `duration`,
 * using UTC date math. `lifetime` -> `null` (never expires). */
export function computePromotionalExpiresAt(grantedAt: Date, duration: PromotionalDuration): Date | null {
  switch (duration) {
    case 'daily':
      return addUtcDays(grantedAt, 1);
    case 'three_day':
      return addUtcDays(grantedAt, 3);
    case 'weekly':
      return addUtcDays(grantedAt, 7);
    case 'monthly':
      return addUtcMonths(grantedAt, 1);
    case 'two_month':
      return addUtcMonths(grantedAt, 2);
    case 'three_month':
      return addUtcMonths(grantedAt, 3);
    case 'six_month':
      return addUtcMonths(grantedAt, 6);
    case 'yearly':
      return addUtcMonths(grantedAt, 12);
    case 'lifetime':
      return null;
    default: {
      const exhaustive: never = duration;
      throw new Error(`Unhandled promotional duration: ${exhaustive as string}`);
    }
  }
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}
