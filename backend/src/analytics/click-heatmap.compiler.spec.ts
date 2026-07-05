import { compileClickHeatmapQuery } from './click-heatmap.compiler';
import type { ClickHeatmapQuery } from './click-heatmap.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<ClickHeatmapQuery> = {}): ClickHeatmapQuery {
  return {
    screen_name: 'checkout',
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    grid: { cols: 20, rows: 40 },
    filters: [],
    ...overrides,
  };
}

describe('compileClickHeatmapQuery (contracts §19)', () => {
  it('filters $tap on the screen, normalizes by the screen-size columns, buckets into the grid', () => {
    const { sql, params } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);

    expect(sql).toContain('project_id = {projectId:UUID}');
    expect(sql).toContain("event = '$tap'");
    // Screen name is a bound param; $screen_name is OUR reserved literal.
    expect(sql).toContain("JSONExtractString(toJSONString(properties), '$screen_name') = {screen:String}");
    // Skip un-normalizable rows.
    expect(sql).toContain('screen_width > 0');
    expect(sql).toContain('screen_height > 0');
    // Normalization + clamped bucketing on both axes.
    expect(sql).toContain("JSONExtractFloat(toJSONString(properties), '$pos_x') / screen_width * {cols:UInt32}");
    expect(sql).toContain("JSONExtractFloat(toJSONString(properties), '$pos_y') / screen_height * {rows:UInt32}");
    expect(sql).toContain('greatest(0, least(toInt32({cols:UInt32}) - 1');
    expect(sql).toContain('GROUP BY cx, cy');

    expect(params.projectId).toBe(PROJECT_ID);
    expect(params.screen).toBe('checkout');
    expect(params.cols).toBe(20);
    expect(params.rows).toBe(40);
  });

  it('compiles §14 filters as bound params (custom-property path)', () => {
    const { sql, params } = compileClickHeatmapQuery(
      baseQuery({ filters: [{ property: 'plan', op: 'eq', value: 'pro' }] }),
      PROJECT_ID,
    );
    expect(sql).toContain('{filterKey0:String}');
    expect(sql).toContain('{filterVal0:String}');
    expect(params.filterVal0).toBe('pro');
  });

  describe('INJECTION', () => {
    it('a malicious screen_name / filter value is bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileClickHeatmapQuery(
        baseQuery({
          screen_name: attack,
          filters: [{ property: 'os', op: 'eq', value: attack }],
        }),
        PROJECT_ID,
      );
      expect(params.screen).toBe(attack);
      expect(params.filterVal0).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });
  });
});
