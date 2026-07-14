import { insightsFilterSchema, insightsQuerySchema } from './insights-query.schema';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    events: [{ name: 'checkout_completed', aggregation: 'total' }],
    date_range: { from: '2026-06-01', to: '2026-06-02' },
    interval: 'day',
    ...overrides,
  };
}

describe('insightsQuerySchema', () => {
  it('accepts a minimal valid query and defaults filters to []', () => {
    const parsed = insightsQuerySchema.parse(validQuery());
    expect(parsed.filters).toEqual([]);
    expect(parsed.breakdown).toBeUndefined();
  });

  it('accepts a fully-populated valid query', () => {
    const parsed = insightsQuerySchema.parse(
      validQuery({
        events: [
          { name: 'checkout_completed', aggregation: 'total' },
          { name: 'product_viewed', aggregation: 'unique_users' },
        ],
        filters: [{ property: 'os', op: 'eq', value: 'ios' }],
        breakdown: { property: 'utm_source' },
      }),
    );
    expect(parsed.events).toHaveLength(2);
    expect(parsed.breakdown).toEqual({ property: 'utm_source' });
  });

  it('rejects zero events', () => {
    expect(insightsQuerySchema.safeParse(validQuery({ events: [] })).success).toBe(false);
  });

  it('rejects more than 5 events', () => {
    const events = Array.from({ length: 6 }, (_, i) => ({
      name: `evt_${i}`,
      aggregation: 'total',
    }));
    const result = insightsQuerySchema.safeParse(validQuery({ events }));
    expect(result.success).toBe(false);
  });

  it('accepts exactly 5 events (the upper bound)', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      name: `evt_${i}`,
      aggregation: 'total',
    }));
    expect(insightsQuerySchema.safeParse(validQuery({ events })).success).toBe(true);
  });

  it('rejects an unknown aggregation', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ events: [{ name: 'checkout_completed', aggregation: 'average' }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an unknown interval', () => {
    const result = insightsQuerySchema.safeParse(validQuery({ interval: 'fortnight' }));
    expect(result.success).toBe(false);
  });

  it.each(['hour', 'day', 'week', 'month'])('accepts interval "%s"', (interval) => {
    expect(insightsQuerySchema.safeParse(validQuery({ interval })).success).toBe(true);
  });

  it('rejects an unknown filter op', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ filters: [{ property: 'os', op: 'startswith', value: 'a' }] }),
    );
    expect(result.success).toBe(false);
  });

  it.each(['eq', 'neq', 'contains', 'gt', 'lt', 'is_set', 'is_not_set'])(
    'accepts filter op "%s"',
    (op) => {
      const filter =
        op === 'is_set' || op === 'is_not_set'
          ? { property: 'os', op }
          : { property: 'os', op, value: 'ios' };
      expect(insightsQuerySchema.safeParse(validQuery({ filters: [filter] })).success).toBe(true);
    },
  );

  it('rejects eq/neq/gt/lt/contains filters missing a value', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ filters: [{ property: 'os', op: 'eq' }] }),
    );
    expect(result.success).toBe(false);
  });

  it('allows is_set/is_not_set filters with no value', () => {
    expect(
      insightsQuerySchema.safeParse(validQuery({ filters: [{ property: 'os', op: 'is_set' }] }))
        .success,
    ).toBe(true);
    expect(
      insightsQuerySchema.safeParse(validQuery({ filters: [{ property: 'os', op: 'is_not_set' }] }))
        .success,
    ).toBe(true);
  });

  it('rejects a malformed date (wrong shape)', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ date_range: { from: '06/01/2026', to: '2026-06-02' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a malformed date (not a real calendar date)', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ date_range: { from: '2026-02-30', to: '2026-03-01' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects date_range where from > to', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ date_range: { from: '2026-06-05', to: '2026-06-01' } }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts date_range where from === to', () => {
    const result = insightsQuerySchema.safeParse(
      validQuery({ date_range: { from: '2026-06-01', to: '2026-06-01' } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts target "profile" on a filter and defaults target to undefined', () => {
    const parsed = insightsFilterSchema.parse({
      property: '$rc_status',
      op: 'eq',
      value: 'active',
      target: 'profile',
    });
    expect(parsed.target).toBe('profile');
    expect(
      insightsFilterSchema.parse({ property: 'os', op: 'eq', value: 'ios' }).target,
    ).toBeUndefined();
  });

  it('rejects an unknown target', () => {
    const result = insightsFilterSchema.safeParse({
      property: 'x',
      op: 'eq',
      value: 'y',
      target: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('accepts numeric and boolean filter values', () => {
    expect(
      insightsQuerySchema.safeParse(
        validQuery({ filters: [{ property: 'value', op: 'gt', value: 9.99 }] }),
      ).success,
    ).toBe(true);
    expect(
      insightsQuerySchema.safeParse(
        validQuery({ filters: [{ property: 'is_pro', op: 'eq', value: true }] }),
      ).success,
    ).toBe(true);
  });
});
