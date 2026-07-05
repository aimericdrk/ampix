/**
 * Fixed-order categorical palette for charts (dataviz spec). CSS variables --series-1..8 (plus
 * --series-other for overflow) are defined in index.css with light/dark values, flipped
 * automatically by the existing `.dark` class toggle (lib/theme.tsx) — colors are referenced via
 * `var(--series-N)` here rather than hard-coded hex so dark mode is a selected step, not an
 * auto-invert, and every consumer (recharts marks, legend swatches, stat tiles) stays in sync.
 */
export const SERIES_COLOR_VARS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

export const SERIES_OTHER_COLOR_VAR = 'var(--series-other)';

/**
 * Fixed-order categorical color for the Nth entity in a stable list (pie slices, stacked segments,
 * standalone series). Identity is the list index the caller supplies — never rank — so a filtered-out
 * entity never repaints its neighbours. A 9th+ entity folds into --series-other (dataviz spec).
 */
export function colorForIndex(index: number): string {
  return SERIES_COLOR_VARS[index] ?? SERIES_OTHER_COLOR_VAR;
}

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

/**
 * Sequential single-hue ramp (dataviz spec) — the validated BLUE scale, light→dark. Continuous
 * magnitude only (the click-heatmap): the lightest step reads as "near zero" and recedes toward the
 * surface; darker = more taps. One hue, never a rainbow. Shared light/dark because heatmap cells sit
 * over an opaque screenshot, not a themed chart surface.
 */
export const SEQUENTIAL_BLUE_RAMP = [
  '#cde2fb',
  '#9ec5f4',
  '#6da7ec',
  '#3987e5',
  '#256abf',
  '#184f95',
  '#0d366b',
] as const;

function lerpChannel(a: number, b: number, frac: number): number {
  return Math.round(a + (b - a) * frac);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Maps a normalized magnitude `t`∈[0,1] onto the sequential blue ramp, interpolating in sRGB between
 * adjacent validated stops. `t` outside [0,1] or non-finite clamps to the ends.
 */
export function sequentialColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const stops = SEQUENTIAL_BLUE_RAMP;
  const scaled = clamped * (stops.length - 1);
  const lower = Math.floor(scaled);
  if (lower >= stops.length - 1) return stops[stops.length - 1]!;
  const frac = scaled - lower;
  const [r1, g1, b1] = hexToRgb(stops[lower]!);
  const [r2, g2, b2] = hexToRgb(stops[lower + 1]!);
  return `rgb(${lerpChannel(r1, r2, frac)}, ${lerpChannel(g1, g2, frac)}, ${lerpChannel(b1, b2, frac)})`;
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
