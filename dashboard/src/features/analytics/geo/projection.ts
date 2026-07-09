/**
 * Minimal GeoJSON geometry shapes used by the bundled world-countries feature collection — just
 * enough typing for the choropleth, not a full GeoJSON spec (no @types/geojson dependency).
 */
export type GeoPosition = [number, number] | [number, number, number];
export type GeoRing = GeoPosition[];
export type GeoPolygonCoordinates = GeoRing[];
export type GeoMultiPolygonCoordinates = GeoPolygonCoordinates[];

export interface GeoPolygonGeometry {
  type: 'Polygon';
  coordinates: GeoPolygonCoordinates;
}

export interface GeoMultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: GeoMultiPolygonCoordinates;
}

export type GeoGeometry = GeoPolygonGeometry | GeoMultiPolygonGeometry;

export interface GeoFeature {
  type: 'Feature';
  id: string | number;
  properties: { name: string } & Record<string, unknown>;
  geometry: GeoGeometry;
}

export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

/**
 * Equirectangular projection: lon/lat (degrees) -> SVG (x, y) inside a `w`x`h` viewBox.
 * `x` runs 0 (lon -180) -> w (lon 180); `y` runs 0 (lat 90) -> h (lat -90) since SVG y grows down.
 */
export function project(lon: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Projects one ring into an `M x0 y0 L x1 y1 … Z` path segment; `''` for an empty/degenerate ring. */
function ringPath(ring: GeoRing, w: number, h: number): string {
  if (!ring || ring.length === 0) return '';
  const points = ring.map(([lon, lat]) => {
    const [x, y] = project(lon, lat, w, h);
    return `${round2(x)} ${round2(y)}`;
  });
  const [first, ...rest] = points;
  const commands = [`M ${first}`, ...rest.map((point) => `L ${point}`), 'Z'];
  return commands.join(' ');
}

function polygonRings(geometry: GeoGeometry): GeoPolygonCoordinates[] {
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
}

/**
 * Converts a GeoJSON `Polygon`/`MultiPolygon` feature into a single SVG path `d` string — one
 * `M…L…Z` subpath per ring, concatenated (a `MultiPolygon`'s rings all fold into the same path).
 * Coordinates are rounded to ~2dp to keep the path compact. Never throws on empty/degenerate
 * rings or a missing geometry — returns `''` instead so a bad feature never breaks the map.
 */
export function featurePath(feature: GeoFeature, w: number, h: number): string {
  const geometry = feature?.geometry;
  if (!geometry) return '';

  const subpaths: string[] = [];
  for (const rings of polygonRings(geometry)) {
    for (const ring of rings) {
      const d = ringPath(ring, w, h);
      if (d) subpaths.push(d);
    }
  }
  return subpaths.join(' ');
}

/**
 * Bounding-box center of a feature's projected geometry, in the same `w`x`h` coordinate space as
 * `featurePath` — used to anchor the hover/focus tooltip near the country without a full polygon
 * centroid computation. Returns `null` for a feature with no renderable rings.
 */
export function featureCenter(feature: GeoFeature, w: number, h: number): [number, number] | null {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rings of polygonRings(geometry)) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        const [x, y] = project(lon, lat, w, h);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
