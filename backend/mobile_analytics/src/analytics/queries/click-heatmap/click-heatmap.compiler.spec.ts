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
    // Skip un-normalizable rows. y survives on EITHER measure — a tap carrying its own page
    // geometry is normalizable even where the screen height is missing.
    expect(sql).toContain('screen_width > 0');
    expect(sql).toContain('screen_height > 0');
    // Normalization + clamped bucketing on both axes. x stays viewport-relative (pages scroll
    // vertically); y prefers content space and falls back to the viewport.
    expect(sql).toContain(
      "(JSONExtractFloat(toJSONString(properties), '$pos_x') / screen_width) * {cols:UInt32}",
    );
    expect(sql).toContain("JSONExtractFloat(toJSONString(properties), '$pos_y') / screen_height");
    expect(sql).toContain('greatest(0, least(toInt32({cols:UInt32}) - 1');
    expect(sql).toContain('GROUP BY cx, cy');

    expect(params.projectId).toBe(PROJECT_ID);
    expect(params.screen).toBe('checkout');
    expect(params.cols).toBe(20);
    expect(params.rows).toBe(40);
  });

  /**
   * The reason this exists: `$pos_y` is measured against the visible viewport, so on a scrollable
   * screen the same content reports a different value depending on how far the user had scrolled.
   * A tap that carries its own page geometry is normalized against the page instead, which is what
   * makes it placeable on a full-page screenshot.
   */
  it('normalizes y against the page when the tap carries content geometry', () => {
    const { sql } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);

    expect(sql).toContain(
      "if(JSONExtractFloat(toJSONString(properties), '$content_height') > 0, JSONExtractFloat(toJSONString(properties), '$content_y') / JSONExtractFloat(toJSONString(properties), '$content_height')",
    );
  });

  /**
   * Not a transitional convenience: an SDK change only reaches users through an app-store release,
   * so viewport-only taps keep arriving for months, and a screen that doesn't scroll never emits
   * content geometry at all. Losing this fallback would silently empty the heatmap.
   */
  it('falls back to viewport normalization when there is no content geometry', () => {
    const { sql } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);

    expect(sql).toContain(
      "JSONExtractFloat(toJSONString(properties), '$pos_y') / screen_height)",
    );
  });

  it('keeps a tap with page geometry but no screen height', () => {
    const { sql } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);

    expect(sql).toContain(
      "(JSONExtractFloat(toJSONString(properties), '$content_height') > 0 OR screen_height > 0)",
    );
  });

  it('clamps a content-space tap into the grid exactly like a viewport one', () => {
    const { sql } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);

    // One clamp wraps the whole if(...) — an edge tap normalizing to 1.0 folds into the last row
    // whichever branch produced it.
    expect(sql).toContain('greatest(0, least(toInt32({rows:UInt32}) - 1, toInt32(floor((if(');
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

  describe('§17 identity-correct per-user filter (distinct_ids)', () => {
    it('adds a bound Array(String) IN filter on the raw distinct_id column when distinct_ids is present', () => {
      const { sql, params } = compileClickHeatmapQuery(
        baseQuery({ distinct_ids: ['u1', 'anon1'] }),
        PROJECT_ID,
      );
      expect(sql).toContain('distinct_id IN {distinctIds:Array(String)}');
      expect(params.distinctIds).toEqual(['u1', 'anon1']);
    });

    it('omits the identity filter entirely when distinct_ids is absent', () => {
      const { sql, params } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);
      expect(sql).not.toContain('distinct_id IN');
      expect(params.distinctIds).toBeUndefined();
    });

    it('omits the identity filter when distinct_ids is an empty array', () => {
      const { sql, params } = compileClickHeatmapQuery(baseQuery({ distinct_ids: [] }), PROJECT_ID);
      expect(sql).not.toContain('distinct_id IN');
      expect(params.distinctIds).toBeUndefined();
    });
  });

  /**
   * The heatmap grid is stretched over the screen's STORED image. When that image is a stitched
   * full-page capture, taps must be normalized against ITS geometry: a tap's own $content_height
   * is the whole page, which is taller than the image whenever the stitch stopped at the SDK's
   * viewport budget — dividing by it shifted every mark up proportionally (field bug: a tap on a
   * button several sections down rendered over a section near the top).
   */
  describe('full-page capture geometry', () => {
    const CAPTURE = { contentHeight: 4800, viewportHeight: 800 };

    it("normalizes content taps against the capture's height, not the tap's own", () => {
      const { sql, params } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID, CAPTURE);

      expect(sql).toContain(
        "JSONExtractFloat(toJSONString(properties), '$content_y') / {imageContentHeight:Float64}",
      );
      expect(params.imageContentHeight).toBe(4800);
      expect(params.imageViewportHeight).toBe(800);
    });

    it('drops content taps below the captured extent instead of clamping them into the bottom row', () => {
      const { sql } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID, CAPTURE);

      expect(sql).toContain(
        "JSONExtractFloat(toJSONString(properties), '$content_y') <= {imageContentHeight:Float64}",
      );
    });

    it('places viewport-only taps at their scroll-0 position within the page', () => {
      const { sql } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID, CAPTURE);

      expect(sql).toContain(
        "'$pos_y') / screen_height) * ({imageViewportHeight:Float64} / {imageContentHeight:Float64})",
      );
    });

    it('without capture geometry the original expressions and params are untouched', () => {
      const { sql, params } = compileClickHeatmapQuery(baseQuery(), PROJECT_ID);

      expect(sql).toContain(
        "JSONExtractFloat(toJSONString(properties), '$content_y') / JSONExtractFloat(toJSONString(properties), '$content_height')",
      );
      expect(params.imageContentHeight).toBeUndefined();
      expect(params.imageViewportHeight).toBeUndefined();
    });
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

    it('a distinct_id containing SQL metacharacters stays only in params, never in the SQL', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileClickHeatmapQuery(
        baseQuery({ distinct_ids: ['u1', attack] }),
        PROJECT_ID,
      );
      expect(params.distinctIds).toEqual(['u1', attack]);
      expect(sql).toContain('distinct_id IN {distinctIds:Array(String)}');
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });
  });
});
