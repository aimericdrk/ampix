import { useId } from 'react';
import { SeriesGradient } from './chart-theme';

/**
 * A tiny, axis-less trend line — inline SVG (not recharts) so it stays crisp at ~32px and is
 * dependency-free. 2px stroke in series-1, a soft `var(--accent)` gradient area fill under the
 * line (the tile's own accent, not a data-encoded series color — this reads as decorative chrome,
 * matching how KPI tiles use the sparkline as a faint backdrop), and a ≥8px end marker anchored to
 * the last point with a 2px surface ring (dataviz mark spec). Decorative: the values back a
 * headline number beside it. Shared by `StatTile` and `KpiTile`.
 *
 * `stretch` turns it into a full-bleed strip that spans whatever box it is given, for the tiles
 * that pin it across the card's bottom edge. At its natural 96px the line covered barely a third
 * of a ≥240px tile and sat flush against the card's left edge, ignoring the padding every other
 * element lines up with. Stretching scales the geometry horizontally (`preserveAspectRatio="none"`)
 * while `vector-effect="non-scaling-stroke"` keeps the 2px line at 2px instead of smearing it with
 * the path, and the end marker moves to a real-pixel overlay so it stays a circle rather than
 * being drawn out into an ellipse.
 */
export function Sparkline({
  values,
  width = 96,
  height = 32,
  stretch = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** Span the full width of the parent instead of drawing at the natural `width`. */
  stretch?: boolean;
}) {
  const gradientId = useId();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath =
    first && last
      ? `${path} L${last[0].toFixed(1)},${height} L${first[0].toFixed(1)},${height} Z`
      : undefined;

  const defs = (
    <defs>
      <SeriesGradient id={gradientId} color="var(--accent)" />
    </defs>
  );
  const area = areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" /> : null;

  if (stretch) {
    return (
      <div className="relative w-full" style={{ height }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="block h-full w-full"
        >
          {defs}
          {area}
          <path
            d={path}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {last && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              // The last point sits on the right edge, where a centred 8px dot (plus its 2px ring)
              // would hang half outside the card; clamp it back in rather than letting it clip.
              left: `min(${((last[0] / width) * 100).toFixed(2)}%, calc(100% - 6px))`,
              top: last[1],
              backgroundColor: 'var(--series-1)',
              boxShadow: '0 0 0 2px var(--chart-surface)',
            }}
          />
        )}
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      {defs}
      {area}
      <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {last && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={4}
          fill="var(--series-1)"
          stroke="var(--chart-surface)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
