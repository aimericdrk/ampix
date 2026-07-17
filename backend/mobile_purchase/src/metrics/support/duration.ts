// Date part (Y/M/W/D) then optional time part (T H/M/S). The `M` after `T` is minutes, before is months.
const ISO_DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Factor to multiply a subscription's per-period price by to normalize it to a monthly figure,
 * derived from an ISO-8601 duration (a month is modeled as 30 days). Returns `null` for an
 * unparseable / empty / zero-length duration so the caller can EXCLUDE the sub from MRR and count
 * it as unattributed rather than silently dropping revenue.
 *
 *   P1M -> 1, P1Y -> 1/12, P3M -> 1/3, P6M -> 1/6, P1W|P7D -> 30/7, P1D -> 30
 */
export function monthlyMultiplier(durationIso8601: string | null | undefined): number | null {
  if (!durationIso8601) return null;
  const match = ISO_DURATION_RE.exec(durationIso8601.trim().toUpperCase());
  if (!match) return null;
  const [, y, mo, w, d, h, min, s] = match;
  const totalDays = num(d) + num(h) / 24 + num(min) / 1440 + num(s) / 86400;
  const monthsEquivalent = num(y) * 12 + num(mo) + num(w) * (7 / 30) + totalDays / 30;
  if (!(monthsEquivalent > 0)) return null;
  return 1 / monthsEquivalent;
}

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}
