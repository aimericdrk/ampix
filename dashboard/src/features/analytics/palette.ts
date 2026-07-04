/**
 * Fixed-order categorical palette for charts (dataviz spec). CSS variables --series-1..8 (plus
 * --series-other for overflow) are defined in index.css with light/dark values, flipped
 * automatically by the existing `.dark` class toggle (lib/theme.tsx) — colors are referenced via
 * `var(--series-N)` here rather than hard-coded hex so dark mode is a selected step, not an
 * auto-invert, and every consumer (recharts marks, legend swatches, stat tiles) stays in sync.
 */
const SERIES_COLOR_VARS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

const SERIES_OTHER_COLOR_VAR = 'var(--series-other)';

/** A separator that can't appear in an event name or property value, so keys never collide. */
const KEY_SEPARATOR = '\u0000';

export function seriesKey(name: string, breakdownValue: string | null): string {
  return `${name}${KEY_SEPARATOR}${breakdownValue ?? ''}`;
}

function splitKey(key: string): [name: string, breakdownValue: string] {
  const separatorIndex = key.indexOf(KEY_SEPARATOR);
  return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

export function seriesLabel(name: string, breakdownValue: string | null): string {
  return breakdownValue ? `${name} · ${breakdownValue}` : name;
}

interface SeriesIdentity {
  name: string;
  breakdown_value: string | null;
}

/**
 * Assigns each distinct series (event × breakdown value) a color in FIXED ORDER — never cycled,
 * never reassigned by array position. Order is derived from the query definition itself (the
 * order events were added to the builder, then breakdown value alphabetically), not from the
 * API response's array order, so a filter that drops a series never repaints the survivors. A
 * 9th+ distinct series folds into --series-other.
 */
export function assignSeriesColors(
  series: SeriesIdentity[],
  eventOrder: string[],
): Map<string, string> {
  const uniqueKeys = Array.from(new Set(series.map((s) => seriesKey(s.name, s.breakdown_value))));

  const ordered = [...uniqueKeys].sort((a, b) => {
    const [aName, aBreakdown] = splitKey(a);
    const [bName, bBreakdown] = splitKey(b);
    const aIndex = eventOrder.indexOf(aName);
    const bIndex = eventOrder.indexOf(bName);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return aBreakdown.localeCompare(bBreakdown);
  });

  const colors = new Map<string, string>();
  ordered.forEach((key, index) => {
    colors.set(key, SERIES_COLOR_VARS[index] ?? SERIES_OTHER_COLOR_VAR);
  });
  return colors;
}
