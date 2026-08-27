import { clickHeatmapQuerySchema } from './click-heatmap.schema';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    screen_name: 'checkout',
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    grid: { cols: 20, rows: 43 },
    ...overrides,
  };
}

describe('clickHeatmapQuerySchema (contracts §19)', () => {
  it('accepts a minimal valid query and defaults filters to []', () => {
    const parsed = clickHeatmapQuerySchema.parse(validQuery());
    expect(parsed.grid).toEqual({ cols: 20, rows: 43 });
    expect(parsed.filters).toEqual([]);
  });

  /**
   * The grid axes do not span the same thing: columns cover one screen width, rows cover the stored
   * capture's whole content height. A square-celled grid over a full-page capture 2.5 screens tall
   * needs ~108 rows, and over the SDK's 6-viewport maximum ~260 — all of which the old symmetric
   * cap of 100 rejected, forcing the caller to stretch its cells instead.
   */
  it('accepts the tall grids a full-page capture needs', () => {
    expect(clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 20, rows: 108 } })).grid.rows).toBe(108);
    expect(clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 20, rows: 260 } })).grid.rows).toBe(260);
    expect(clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 20, rows: 400 } })).grid.rows).toBe(400);
  });

  it('still bounds both axes', () => {
    expect(() => clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 20, rows: 401 } }))).toThrow();
    expect(() => clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 101, rows: 43 } }))).toThrow();
    expect(() => clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 0, rows: 43 } }))).toThrow();
    expect(() => clickHeatmapQuerySchema.parse(validQuery({ grid: { cols: 20, rows: 43.5 } }))).toThrow();
  });

  it('rejects a missing screen_name', () => {
    expect(() => clickHeatmapQuerySchema.parse(validQuery({ screen_name: '  ' }))).toThrow();
  });
});
