import { ProblemException } from '../common/problem-details';
import { toChDateTime64 } from '../clickhouse/clickhouse.service';

/**
 * Pure query-string parsing/validation helpers shared by the §14 "read" endpoints (live feed,
 * users explorer, sessions summary). Kept separate from `insights-query.schema.ts` because these
 * parse plain `@Query()` strings (always `string | undefined`), not a typed JSON body — but they
 * follow the same rule as everywhere else in this module: a malformed value is a 400
 * `ProblemException`, never a silent fallback that could mask a client bug, EXCEPT `limit`, which
 * the contract explicitly says to clamp rather than reject.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** contracts §14 `/meta/property-values`: a filter-value autosuggest dropdown wants more candidates
 *  than the live/users feeds, so it caps higher — default 50, hard max 200. */
export const PROPERTY_VALUES_DEFAULT_LIMIT = 50;
export const PROPERTY_VALUES_MAX_LIMIT = 200;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** contracts §14 `/sessions/summary`: "default range last 30 days if omitted". */
const DEFAULT_RANGE_DAYS = 30;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects syntactically-plausible but non-existent dates (e.g. `2026-02-30`). Mirrors the
 *  identical guard in `insights-query.schema.ts` — duplicated (not imported) so this module has no
 *  dependency on the query-engine's body schema. */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parseDateOnlyUTC(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateOnlyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function badRequest(detail: string): ProblemException {
  return new ProblemException({ status: 400, title: 'Bad Request', detail });
}

function validateDateOnly(raw: string, paramName: string): string {
  if (!DATE_ONLY_RE.test(raw) || !isRealCalendarDate(raw)) {
    throw badRequest(`${paramName}: must be an ISO date (YYYY-MM-DD)`);
  }
  return raw;
}

/**
 * Clamps a raw `limit` query param string to `[1, MAX_LIMIT]`, defaulting to `DEFAULT_LIMIT` when
 * absent, non-numeric, or out of range on the low end (contracts §14: "limit clamped ≤100" for
 * both `/events/live` and `/users`).
 */
export function clampLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

/**
 * Clamps `/meta/property-values`' raw `limit` query param to `[1, {@link PROPERTY_VALUES_MAX_LIMIT}]`,
 * defaulting to {@link PROPERTY_VALUES_DEFAULT_LIMIT} when absent, non-numeric, or below 1 — same
 * clamp-never-reject rule as {@link clampLimit}, just with the higher autosuggest ceiling.
 */
export function clampPropertyValuesLimit(raw: string | undefined): number {
  if (raw === undefined) return PROPERTY_VALUES_DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return PROPERTY_VALUES_DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), PROPERTY_VALUES_MAX_LIMIT);
}

/**
 * Parses an ISO-8601 instant query param (`before`) into a ClickHouse `DateTime64` literal ready
 * to bind as `{before:DateTime64}`. Returns `undefined` when `raw` itself is absent (no filter);
 * throws a 400 on a present-but-unparseable value.
 */
export function parseIsoInstantParam(
  raw: string | undefined,
  paramName: string,
): string | undefined {
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw badRequest(`${paramName}: must be a valid ISO-8601 date-time`);
  }
  return toChDateTime64(ms);
}

export interface DateOnlyRange {
  from: string;
  to: string;
}

/**
 * Resolves the `from`/`to` date-only query params for `/sessions/summary`, defaulting to the
 * trailing {@link DEFAULT_RANGE_DAYS}-day window (inclusive of today, UTC) when either is omitted
 * — contracts §14: "default range last 30 days if omitted". Each side defaults independently so
 * e.g. passing only `to` still yields a sensible 30-day window ending there.
 */
export function resolveDateOnlyRange(fromRaw?: string, toRaw?: string): DateOnlyRange {
  const todayMs = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY;
  const to = toRaw !== undefined ? validateDateOnly(toRaw, 'to') : formatDateOnlyUTC(todayMs);
  const toMs = parseDateOnlyUTC(to);
  const from =
    fromRaw !== undefined
      ? validateDateOnly(fromRaw, 'from')
      : formatDateOnlyUTC(toMs - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY);

  if (from > to) {
    throw badRequest('from must be <= to');
  }
  return { from, to };
}
