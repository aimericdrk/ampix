import { previousRange } from './derive';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed `YYYY-MM-DD` string whose parts all parse to finite numbers. */
function isValidDateString(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  return date.split('-').map(Number).every((part) => Number.isFinite(part));
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseDate(date: string): DateParts {
  const parts = date.split('-').map(Number);
  return { year: parts[0] ?? 0, month: parts[1] ?? 1, day: parts[2] ?? 1 };
}

/** Parses an inclusive `YYYY-MM-DD` date into a UTC-midnight epoch, avoiding local-TZ drift. */
function toUtcDays(date: string): number {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromUtcDays(days: number): string {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Shifts a `YYYY-MM-DD` date back by a whole number of calendar months, clamping the day to the
 * target month's actual length. `Date.UTC` would otherwise silently roll an out-of-range day (e.g.
 * day 31 requested for a 30-day month) forward into the following month, so the target month's
 * last day is computed first and the day clamped to it (e.g. Mar 31 - 1 month -> Feb 28/29, never
 * March 2/3).
 */
function shiftMonthsBack(date: string, months: number): string {
  const { year, month, day } = parseDate(date);
  const targetMonthIndex = month - 1 - months; // 0-based; Date.UTC normalizes over/underflow
  const daysInTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return fromUtcDays(Date.UTC(year, targetMonthIndex, clampedDay) / MS_PER_DAY);
}

export type CompareUnit = 'previous' | 'week' | 'month' | 'year';

/**
 * Derives a compare `{from,to}` range from the current range for a chosen offset `unit` (feat-06
 * §3). Deterministic UTC date math throughout — parses only the string's own `Y-M-D` parts via
 * `Date.UTC`, never `Date.now()` — so the same input always produces the same output.
 *
 * - `'previous'`: the immediately-preceding equal-length window (delegates to {@link previousRange}).
 * - `'week'`: both bounds shifted back exactly 7 days.
 * - `'month'`: both bounds shifted back one calendar month, day clamped to the shifted month's length.
 * - `'year'`: both bounds shifted back exactly one calendar year (clamped for a Feb 29 -> Feb 28).
 *
 * Guards against a corrupt/cleared range the same way `previousRange` does: an invalid `from`/`to`
 * (empty, or not a well-formed `YYYY-MM-DD`) returns the input unchanged rather than feeding `NaN`
 * into `Date.UTC` and throwing during render.
 */
export function shiftRange(from: string, to: string, unit: CompareUnit): { from: string; to: string } {
  if (!isValidDateString(from) || !isValidDateString(to)) {
    return { from, to };
  }

  switch (unit) {
    case 'previous':
      return previousRange(from, to);
    case 'week':
      return { from: fromUtcDays(toUtcDays(from) - 7), to: fromUtcDays(toUtcDays(to) - 7) };
    case 'month':
      return { from: shiftMonthsBack(from, 1), to: shiftMonthsBack(to, 1) };
    case 'year':
      return { from: shiftMonthsBack(from, 12), to: shiftMonthsBack(to, 12) };
    default:
      return { from, to };
  }
}

/**
 * Aligns two arrays by position (index), zipping to the shorter of the two — used to overlay a
 * compare range's points onto the current range's points when the two windows have different
 * lengths (feat-06 §4: "don't crash on unequal lengths"). Never throws on empty input.
 */
export function zipByIndex<A, B>(a: A[], b: B[]): Array<[A, B]> {
  const length = Math.min(a.length, b.length);
  const zipped: Array<[A, B]> = [];
  for (let i = 0; i < length; i++) {
    zipped.push([a[i] as A, b[i] as B]);
  }
  return zipped;
}
