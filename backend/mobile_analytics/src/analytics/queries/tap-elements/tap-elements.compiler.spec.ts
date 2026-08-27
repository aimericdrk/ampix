import { compileTapElementsQuery } from './tap-elements.compiler';
import { tapElementsQuerySchema } from './tap-elements.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';

const baseQuery = (overrides: Record<string, unknown> = {}) =>
  tapElementsQuerySchema.parse({
    screen_name: 'checkout',
    date_range: { from: '2026-06-01', to: '2026-06-02' },
    ...overrides,
  });

describe('compileTapElementsQuery', () => {
  it('groups $tap events for one screen by widget type and label', () => {
    const { sql, params } = compileTapElementsQuery(baseQuery(), PROJECT_ID);

    expect(sql).toContain("event = '$tap'");
    expect(sql).toContain('GROUP BY widget_type, widget_label');
    expect(sql).toContain('ORDER BY cnt DESC');
    expect(params).toMatchObject({ projectId: PROJECT_ID, screen: 'checkout', limit: 25 });
  });

  it('counts distinct users per element alongside the taps', () => {
    const { sql } = compileTapElementsQuery(baseQuery(), PROJECT_ID);
    expect(sql).toContain('uniqExact(distinct_id) AS users');
  });

  /**
   * The whole point of this query: it never divides by `screen_width`/`screen_height`, so it makes
   * no claim about WHERE on the screen a tap landed. That is what keeps it correct on a scrollable
   * screen, where the recorded position has no scroll offset to place it by.
   */
  it('never normalizes by screen size — no geometry, so no scroll assumption', () => {
    const { sql } = compileTapElementsQuery(baseQuery(), PROJECT_ID);
    expect(sql).not.toContain('screen_width');
    expect(sql).not.toContain('screen_height');
    expect(sql).not.toContain('$pos_x');
    expect(sql).not.toContain('$pos_y');
  });

  it('binds the §17 identity set as an array param, filtering the raw distinct_id', () => {
    const { sql, params } = compileTapElementsQuery(
      baseQuery({ distinct_ids: ['user-1', 'anon-1'] }),
      PROJECT_ID,
    );
    expect(sql).toContain('distinct_id IN {distinctIds:Array(String)}');
    expect(params.distinctIds).toEqual(['user-1', 'anon-1']);
  });

  it('omits the identity filter entirely when no ids are given', () => {
    const { sql, params } = compileTapElementsQuery(baseQuery(), PROJECT_ID);
    expect(sql).not.toContain('distinctIds');
    expect(params.distinctIds).toBeUndefined();
  });

  // Same doctrine as every other compiler here: caller input is bound, never inlined.
  it('INJECTION: a malicious screen name and filter value are only ever bound', () => {
    const attack = "'; DROP TABLE events; --";
    const { sql, params } = compileTapElementsQuery(
      baseQuery({
        screen_name: attack,
        filters: [{ property: 'os', op: 'eq', value: attack }],
      }),
      PROJECT_ID,
    );
    expect(params.screen).toBe(attack);
    expect(params.filterVal0).toBe(attack);
    expect(sql).not.toContain(attack);
  });

  it('clamps the limit to the schema bounds', () => {
    expect(() => baseQuery({ limit: 0 })).toThrow();
    expect(() => baseQuery({ limit: 201 })).toThrow();
    expect(compileTapElementsQuery(baseQuery({ limit: 200 }), PROJECT_ID).params.limit).toBe(200);
  });
});
