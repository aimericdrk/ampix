import { GlowCard } from '../../../components/ui/glow-card';
import { IconTrendDown, IconTrendUp } from '../../../components/ui/icons';
import type { Highlight } from '../highlights';

const TEXT_TONE: Record<Highlight['tone'], string> = {
  positive: 'text-accent',
  negative: 'text-danger',
  neutral: 'text-text-muted',
};

/**
 * A compact strip of auto-generated, plain-language highlights — the most notable
 * period-over-period changes among the metrics Home already loaded (see `computeHighlights`),
 * each paired with a direction icon so meaning survives grayscale/CVD viewing. Renders nothing
 * when there's nothing worth calling out (a fresh project, or every metric holding flat).
 */
export function HomeHighlights({ highlights }: { highlights: Highlight[] }) {
  if (highlights.length === 0) return null;

  return (
    <ul aria-label="Highlights" className="flex flex-wrap gap-3">
      {highlights.map((highlight) => (
        <li key={highlight.id}>
          <GlowCard
            outerClassName="rounded-full"
            className="flex items-center gap-2 rounded-full px-3 py-2 text-sm"
          >
            <HighlightIcon tone={highlight.tone} />
            <span className={TEXT_TONE[highlight.tone]}>{highlight.text}</span>
          </GlowCard>
        </li>
      ))}
    </ul>
  );
}

/** Colour-blind-safe direction glyph: colour is always paired with an icon shape, never used alone. */
function HighlightIcon({ tone }: { tone: Highlight['tone'] }) {
  if (tone === 'positive') return <IconTrendUp className="shrink-0 text-accent" />;
  if (tone === 'negative') return <IconTrendDown className="shrink-0 text-danger" />;
  return (
    <span aria-hidden="true" className="shrink-0 text-text-muted">
      •
    </span>
  );
}
