import { pctDelta } from './derive';
import { formatExactNumber } from './format';

/** A single period-over-period metric Home already has current/previous values for. */
export interface HighlightMetricInput {
  label: string;
  current: number;
  previous: number;
  /** Whether a larger value is the desirable direction. Defaults to `true`. */
  higherIsBetter?: boolean;
  unit?: 'count' | 'percent' | 'duration' | 'currency';
}

export interface HighlightExtras {
  /** The single most-frequent event this period, if any — surfaced as an FYI, not a trend. */
  topEvent?: { event: string; count: number };
}

export interface Highlight {
  id: string;
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  /** `|delta%|` (or a fixed sentinel for the "new data" / top-event cases) — used only for ranking. */
  magnitude: number;
}

/** Below this absolute percent change, a metric reads as flat rather than a real move. */
const NEUTRAL_THRESHOLD_PCT = 2;
const MAX_HIGHLIGHTS = 4;
/** Ranking sentinel for "first data this period" — notable, but not a trend to rank by %. */
const NEW_DATA_MAGNITUDE = 100;

/** Slug-cases a label for use in a deterministic highlight id (`"Avg. session"` -> `"avg-session"`). */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Sort bucket: real trends first, other informational notes next, the top-event FYI always last. */
function rankBucket(highlight: Highlight): number {
  if (highlight.id === 'top-event') return 2;
  if (highlight.tone === 'neutral') return 1;
  return 0;
}

/**
 * Scans already-fetched current/previous metric pairs for the most notable period-over-period
 * changes and renders them as short, plain-language highlights — ranked by magnitude, real
 * moves first, informational notes (flat metrics, brand-new data, the top event) last. Pure and
 * deterministic: no `Date`/`Math.random`, so the same inputs always produce the same output.
 */
export function computeHighlights(
  metrics: HighlightMetricInput[],
  extras?: HighlightExtras,
): Highlight[] {
  const highlights: Highlight[] = [];

  for (const metric of metrics) {
    const { label, current, previous, higherIsBetter = true } = metric;

    // Nothing happened at all — not worth a line.
    if (previous === 0 && current === 0) continue;

    const id = `metric-${slugify(label)}`;

    if (previous === 0 && current > 0) {
      highlights.push({
        id,
        text: `${label}: first data this period`,
        tone: 'neutral',
        magnitude: NEW_DATA_MAGNITUDE,
      });
      continue;
    }

    const delta = pctDelta(current, previous);
    const magnitude = Math.abs(delta);
    const isIncrease = delta >= 0;
    const isFlat = magnitude < NEUTRAL_THRESHOLD_PCT;

    const tone: Highlight['tone'] = isFlat
      ? 'neutral'
      : isIncrease === higherIsBetter
        ? 'positive'
        : 'negative';

    const text = isFlat
      ? `${label} roughly flat vs previous period`
      : `${label} ${isIncrease ? 'up' : 'down'} ${Math.round(magnitude)}% vs previous period`;

    highlights.push({ id, text, tone, magnitude });
  }

  if (extras?.topEvent) {
    highlights.push({
      id: 'top-event',
      text: `Top event: ${extras.topEvent.event} (${formatExactNumber(extras.topEvent.count)})`,
      tone: 'neutral',
      magnitude: 0,
    });
  }

  return highlights
    .slice()
    .sort((a, b) => rankBucket(a) - rankBucket(b) || b.magnitude - a.magnitude)
    .slice(0, MAX_HIGHLIGHTS);
}
