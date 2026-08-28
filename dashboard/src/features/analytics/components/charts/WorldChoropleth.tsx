import { useMemo, useState, type KeyboardEvent } from 'react';
import worldGeoJson from '../../geo/world-countries.geo.json';
import {
  featureCenter,
  featurePath,
  type GeoFeature,
  type GeoFeatureCollection,
} from '../../geo/projection';
import { iso3Name } from '../../geo/country-codes';
import { SEQUENTIAL_BLUE_RAMP, sequentialColor } from '../../palette';
import { formatExactNumber, formatPercent } from '../../format';
import { cn } from '../../../../lib/cn';
import { CollapsibleTable } from '../../../../components/ui/CollapsibleTable';

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 500;

/** Muted, non-blue fill for countries absent from `data` — never mistaken for a "0 installs" blue. */
const NO_DATA_FILL = 'var(--border)';

export interface WorldChoroplethProps {
  /** ISO-3 country code -> metric value (e.g. install count). */
  data: Record<string, number>;
  ariaLabel: string;
  /** Unit suffix appended to formatted values, e.g. "installs". */
  valueLabel?: string;
  height?: number;
  onSelectCountry?: (iso3: string) => void;
}

interface ProjectedFeature {
  iso3: string;
  name: string;
  d: string;
  center: [number, number] | null;
}

/**
 * Projects the bundled world geometry once per component instance — the path geometry depends
 * only on the fixed viewBox size, never on `data`, so this memo never recomputes when the metric
 * values change (feat-18 §3.4 perf note). Features with no renderable rings are dropped.
 */
function useProjectedFeatures(): ProjectedFeature[] {
  return useMemo(() => {
    const collection = worldGeoJson as GeoFeatureCollection;
    const projected: ProjectedFeature[] = [];
    for (const feature of collection.features as GeoFeature[]) {
      const d = featurePath(feature, VIEWBOX_WIDTH, VIEWBOX_HEIGHT);
      if (!d) continue;
      const iso3 = String(feature.id);
      // `iso3Name` first so a shape's tooltip and its row in the table below say the SAME thing:
      // the bundled geometry carries its own formal names ("United States of America") and the
      // table uses our short ones, and two names for one country reads as two countries. Falls
      // back to the geometry's name for any feature whose id is not a known ISO-3 code.
      const isoName = iso3Name(iso3);
      projected.push({
        iso3,
        name: isoName === iso3 ? (feature.properties?.name ?? iso3) : isoName,
        d,
        center: featureCenter(feature, VIEWBOX_WIDTH, VIEWBOX_HEIGHT),
      });
    }
    return projected;
    // Bundled geometry is a static import — this memo intentionally never recomputes.
  }, []);
}

interface TableRow {
  iso3: string;
  name: string;
  value: number;
}

/**
 * A from-scratch interactive world choropleth (feat-18 §3.3) — no map library. Renders the bundled
 * 180-country geometry as one SVG path per country, shaded by a sqrt-scaled sequential ramp so a
 * few huge countries never flatten everyone else. Every country is hoverable and keyboard
 * focusable with a tooltip + accessible label; a full data table below mirrors the same
 * name/value/share so nothing depends on color or a pointer.
 */
export function WorldChoropleth({
  data,
  ariaLabel,
  valueLabel,
  height = 420,
  onSelectCountry,
}: WorldChoroplethProps) {
  const features = useProjectedFeatures();
  const [activeIso3, setActiveIso3] = useState<string | null>(null);

  const max = useMemo(
    () => Object.values(data).reduce((running, value) => Math.max(running, value), 0),
    [data],
  );

  const tableRows: TableRow[] = useMemo(
    () =>
      Object.entries(data)
        .map(([iso3, value]) => ({ iso3, name: iso3Name(iso3), value }))
        .sort((a, b) => b.value - a.value),
    [data],
  );
  const tableTotal = useMemo(() => tableRows.reduce((sum, row) => sum + row.value, 0), [tableRows]);

  const clearActive = (iso3: string) => setActiveIso3((current) => (current === iso3 ? null : current));

  const activeFeature = activeIso3 ? features.find((feature) => feature.iso3 === activeIso3) : undefined;
  const activeValue = activeIso3 ? data[activeIso3] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel}
        className="relative w-full overflow-hidden rounded-lg border border-border"
        style={{
          aspectRatio: `${VIEWBOX_WIDTH} / ${VIEWBOX_HEIGHT}`,
          maxHeight: height,
          backgroundColor: 'var(--chart-surface)',
        }}
      >
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          {features.map((feature, i) => {
            const value = data[feature.iso3];
            const isActive = feature.iso3 === activeIso3;
            const selectable = Boolean(onSelectCountry);
            const label =
              value !== undefined
                ? `${feature.name}: ${formatExactNumber(value)}${valueLabel ? ` ${valueLabel}` : ''}`
                : `${feature.name}: no data`;

            const handleKeyDown = (event: KeyboardEvent<SVGPathElement>) => {
              if (!onSelectCountry) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectCountry(feature.iso3);
              }
            };

            return (
              <path
                key={`${feature.iso3}-${i}`}
                d={feature.d}
                fill={value === undefined ? NO_DATA_FILL : sequentialColor(max > 0 ? Math.sqrt(value) / Math.sqrt(max) : 0)}
                stroke={isActive ? 'var(--accent)' : 'var(--chart-surface)'}
                strokeWidth={isActive ? 2 : 0.5}
                tabIndex={0}
                role="img"
                aria-label={label}
                className={cn(
                  'outline-none motion-safe:transition-[stroke-width,filter] motion-safe:duration-150',
                  selectable && 'cursor-pointer',
                )}
                style={isActive ? { filter: 'drop-shadow(0 0 2px var(--accent))' } : undefined}
                onMouseEnter={() => setActiveIso3(feature.iso3)}
                onMouseLeave={() => clearActive(feature.iso3)}
                onFocus={() => setActiveIso3(feature.iso3)}
                onBlur={() => clearActive(feature.iso3)}
                onKeyDown={handleKeyDown}
                onClick={onSelectCountry ? () => onSelectCountry(feature.iso3) : undefined}
              />
            );
          })}
        </svg>

        {activeFeature && activeFeature.center && (
          <div
            aria-hidden="true"
            data-testid="choropleth-tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md motion-safe:transition-opacity"
            style={{
              left: `${(activeFeature.center[0] / VIEWBOX_WIDTH) * 100}%`,
              top: `${(activeFeature.center[1] / VIEWBOX_HEIGHT) * 100}%`,
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <div className="font-medium">{activeFeature.name}</div>
            <div style={{ color: 'var(--text-muted)' }}>
              {activeValue !== undefined
                ? `${formatExactNumber(activeValue)}${valueLabel ? ` ${valueLabel}` : ''}`
                : 'No data'}
            </div>
          </div>
        )}
      </div>

      <ChoroplethLegend max={max} />

      <WorldChoroplethTable rows={tableRows} total={tableTotal} ariaLabel={ariaLabel} />
    </div>
  );
}

function ChoroplethLegend({ max }: { max: number }) {
  const gradient = `linear-gradient(to right, ${SEQUENTIAL_BLUE_RAMP.join(', ')})`;
  return (
    <div
      data-testid="choropleth-legend"
      className="flex flex-wrap items-center gap-6 text-xs"
      style={{ color: 'var(--text-muted)' }}
    >
      <div className="flex items-center gap-2">
        <span>0</span>
        <span
          aria-hidden="true"
          className="h-3 w-32 rounded-full border border-border"
          style={{ backgroundImage: gradient }}
        />
        <span>{formatExactNumber(max)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-3 w-3 rounded-sm border border-border"
          style={{ backgroundColor: NO_DATA_FILL }}
        />
        <span>No data</span>
      </div>
    </div>
  );
}

function WorldChoroplethTable({
  rows,
  total,
  ariaLabel,
}: {
  rows: TableRow[];
  total: number;
  ariaLabel: string;
}) {
  return (
    <CollapsibleTable count={rows.length}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{`${ariaLabel} data table`}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 font-medium">
              Country
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Value
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.iso3} className="border-b border-border">
              <td className="py-2">{row.name}</td>
              <td className="py-2 text-right tabular-nums">{formatExactNumber(row.value)}</td>
              <td className="py-2 text-right tabular-nums">
                {total > 0 ? formatPercent(row.value / total) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CollapsibleTable>
  );
}
