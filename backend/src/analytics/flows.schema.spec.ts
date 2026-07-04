import { flowsQuerySchema } from './flows.schema';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    anchor: { event: 'app_open' },
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    steps: 3,
    max_nodes_per_step: 8,
    ...overrides,
  };
}

describe('flowsQuerySchema (contracts §15)', () => {
  it('accepts a minimal valid query; defaults direction=forward, unit=session, filters=[]', () => {
    const parsed = flowsQuerySchema.parse(validQuery());
    expect(parsed.direction).toBe('forward');
    expect(parsed.unit).toBe('session');
    expect(parsed.anchor.filters).toEqual([]);
  });

  it('accepts a fully-populated query (backward, user, anchor filters)', () => {
    const parsed = flowsQuerySchema.parse(
      validQuery({
        anchor: { event: 'checkout', filters: [{ property: 'os', op: 'eq', value: 'ios' }] },
        direction: 'backward',
        unit: 'user',
      }),
    );
    expect(parsed.direction).toBe('backward');
    expect(parsed.unit).toBe('user');
  });

  it('rejects an unknown direction', () => {
    expect(flowsQuerySchema.safeParse(validQuery({ direction: 'sideways' })).success).toBe(false);
  });

  it('rejects an unknown unit', () => {
    expect(flowsQuerySchema.safeParse(validQuery({ unit: 'device' })).success).toBe(false);
  });

  it.each([0, -1, 6, 2.5])('rejects steps out of 1..5 (%p)', (steps) => {
    expect(flowsQuerySchema.safeParse(validQuery({ steps })).success).toBe(false);
  });

  it.each([1, 5])('accepts valid steps %p', (steps) => {
    expect(flowsQuerySchema.safeParse(validQuery({ steps })).success).toBe(true);
  });

  it.each([0, -1, 21, 3.5])('rejects max_nodes_per_step out of 1..20 (%p)', (max_nodes_per_step) => {
    expect(flowsQuerySchema.safeParse(validQuery({ max_nodes_per_step })).success).toBe(false);
  });

  it.each([1, 20])('accepts valid max_nodes_per_step %p', (max_nodes_per_step) => {
    expect(flowsQuerySchema.safeParse(validQuery({ max_nodes_per_step })).success).toBe(true);
  });
});
