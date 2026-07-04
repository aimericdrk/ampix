import { funnelsQuerySchema } from './funnels.schema';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    steps: [{ event: 'app_open' }, { event: 'checkout_completed' }],
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    window_days: 7,
    ...overrides,
  };
}

describe('funnelsQuerySchema (contracts §15)', () => {
  it('accepts a minimal valid funnel, defaulting order=any and step filters=[]', () => {
    const parsed = funnelsQuerySchema.parse(validQuery());
    expect(parsed.order).toBe('any');
    expect(parsed.steps[0].filters).toEqual([]);
    expect(parsed.breakdown).toBeUndefined();
  });

  it('accepts a fully-populated funnel (filters, strict_order, breakdown)', () => {
    const parsed = funnelsQuerySchema.parse(
      validQuery({
        steps: [
          { event: 'app_open', filters: [{ property: 'os', op: 'eq', value: 'ios' }] },
          { event: 'signup_started' },
          { event: 'checkout_completed', filters: [{ property: 'plan', op: 'is_set' }] },
        ],
        order: 'strict_order',
        breakdown: { property: 'utm_source' },
      }),
    );
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.order).toBe('strict_order');
    expect(parsed.breakdown).toEqual({ property: 'utm_source' });
  });

  it('rejects fewer than 2 steps', () => {
    expect(funnelsQuerySchema.safeParse(validQuery({ steps: [{ event: 'a' }] })).success).toBe(
      false,
    );
  });

  it('accepts exactly 2 and exactly 8 steps (the bounds)', () => {
    const two = Array.from({ length: 2 }, (_, i) => ({ event: `e${i}` }));
    const eight = Array.from({ length: 8 }, (_, i) => ({ event: `e${i}` }));
    expect(funnelsQuerySchema.safeParse(validQuery({ steps: two })).success).toBe(true);
    expect(funnelsQuerySchema.safeParse(validQuery({ steps: eight })).success).toBe(true);
  });

  it('rejects more than 8 steps', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ event: `e${i}` }));
    expect(funnelsQuerySchema.safeParse(validQuery({ steps: nine })).success).toBe(false);
  });

  it.each([0, -1, 366, 1.5])('rejects bad window_days %p', (window_days) => {
    expect(funnelsQuerySchema.safeParse(validQuery({ window_days })).success).toBe(false);
  });

  it.each([1, 7, 365])('accepts valid window_days %p', (window_days) => {
    expect(funnelsQuerySchema.safeParse(validQuery({ window_days })).success).toBe(true);
  });

  it('rejects an unknown order', () => {
    expect(funnelsQuerySchema.safeParse(validQuery({ order: 'sequential' })).success).toBe(false);
  });

  it('rejects an unknown filter op inside a step', () => {
    const steps = [{ event: 'a', filters: [{ property: 'os', op: 'startswith', value: 'x' }] }, { event: 'b' }];
    expect(funnelsQuerySchema.safeParse(validQuery({ steps })).success).toBe(false);
  });

  it('rejects from > to and a non-calendar date', () => {
    expect(
      funnelsQuerySchema.safeParse(validQuery({ date_range: { from: '2026-07-02', to: '2026-07-01' } }))
        .success,
    ).toBe(false);
    expect(
      funnelsQuerySchema.safeParse(validQuery({ date_range: { from: '2026-02-30', to: '2026-03-01' } }))
        .success,
    ).toBe(false);
  });
});
