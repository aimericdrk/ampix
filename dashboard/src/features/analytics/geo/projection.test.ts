import { describe, expect, it } from 'vitest';
import { featureCenter, featurePath, project, type GeoFeature } from './projection';

describe('project', () => {
  it('maps the null island (0, 0) to the center of the viewBox', () => {
    expect(project(0, 0, 1000, 500)).toEqual([500, 250]);
  });

  it('maps the top-left corner (lon -180, lat 90) to (0, 0)', () => {
    expect(project(-180, 90, 1000, 500)).toEqual([0, 0]);
  });

  it('maps the bottom-right corner (lon 180, lat -90) to (w, h)', () => {
    expect(project(180, -90, 1000, 500)).toEqual([1000, 500]);
  });

  it('maps a known point (lon 90, lat 45) to the expected quarter-viewBox coordinate', () => {
    // x = (90 + 180) / 360 * 1000 = 750; y = (90 - 45) / 180 * 500 = 125
    expect(project(90, 45, 1000, 500)).toEqual([750, 125]);
  });
});

describe('featurePath', () => {
  const squareFeature: GeoFeature = {
    type: 'Feature',
    id: 'SQR',
    properties: { name: 'Squareland' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-10, 10],
          [10, 10],
          [10, -10],
          [-10, -10],
          [-10, 10],
        ],
      ],
    },
  };

  it('renders a Polygon as a single closed M…L…L…L…Z subpath', () => {
    const d = featurePath(squareFeature, 1000, 500);
    expect(d).toMatch(/^M -?\d+(\.\d+)? -?\d+(\.\d+)?( L -?\d+(\.\d+)? -?\d+(\.\d+)?)+ Z$/);
    expect(d.match(/M /g)).toHaveLength(1);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('projects the square ring points to the expected rounded coordinates', () => {
    const d = featurePath(squareFeature, 1000, 500);
    // (-10,10) -> x=(170/360)*1000=472.22, y=(80/180)*500=222.22
    expect(d).toContain('M 472.22 222.22');
    // (10,10) -> x=(190/360)*1000=527.78, y=222.22
    expect(d).toContain('L 527.78 222.22');
    // (10,-10) -> x=527.78, y=(100/180)*500=277.78
    expect(d).toContain('L 527.78 277.78');
  });

  it('concatenates every ring of a MultiPolygon into one path', () => {
    const multi: GeoFeature = {
      type: 'Feature',
      id: 'MPL',
      properties: { name: 'Multiland' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-20, 20],
              [-15, 20],
              [-15, 15],
            ],
          ],
          [
            [
              [15, -15],
              [20, -15],
              [20, -20],
            ],
          ],
        ],
      },
    };
    const d = featurePath(multi, 1000, 500);
    // Two rings -> two M...Z subpaths concatenated in one string.
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });

  it('skips empty rings and never throws on a missing geometry', () => {
    const withEmptyRing: GeoFeature = {
      type: 'Feature',
      id: 'EMP',
      properties: { name: 'Emptyland' },
      geometry: { type: 'Polygon', coordinates: [[], [[1, 1], [2, 2], [3, 1]]] },
    };
    const d = featurePath(withEmptyRing, 1000, 500);
    expect(d.match(/M /g)).toHaveLength(1);

    const noGeometry = { type: 'Feature', id: 'NIL', properties: { name: 'Nil' } } as unknown as GeoFeature;
    expect(featurePath(noGeometry, 1000, 500)).toBe('');
  });
});

describe('featureCenter', () => {
  it('returns the bounding-box center of a Polygon feature', () => {
    const squareFeature: GeoFeature = {
      type: 'Feature',
      id: 'SQR',
      properties: { name: 'Squareland' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-10, 10],
            [10, 10],
            [10, -10],
            [-10, -10],
            [-10, 10],
          ],
        ],
      },
    };
    // bbox in projected space is x:[472.22,527.78], y:[222.22,277.78] -> center (500, 250)
    const center = featureCenter(squareFeature, 1000, 500);
    expect(center?.[0]).toBeCloseTo(500, 1);
    expect(center?.[1]).toBeCloseTo(250, 1);
  });

  it('returns null when there is no renderable geometry', () => {
    const noGeometry = { type: 'Feature', id: 'NIL', properties: { name: 'Nil' } } as unknown as GeoFeature;
    expect(featureCenter(noGeometry, 1000, 500)).toBeNull();
  });
});
