import { retentionQuerySchema } from './retention.schema';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    born_event: { name: 'signup_completed' },
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    interval: 'day',
    periods: 14,
    ...overrides,
  };
}

describe('retentionQuerySchema (contracts §15)', () => {
  it('accepts a minimal valid query; return_event optional, filters default []', () => {
    const parsed = retentionQuerySchema.parse(validQuery());
    expect(parsed.return_event).toBeUndefined();
    expect(parsed.born_event.filters).toEqual([]);
  });

  it('accepts born + return events with filters', () => {
    const parsed = retentionQuerySchema.parse(
      validQuery({
        born_event: { name: 'signup_completed', filters: [{ property: 'os', op: 'eq', value: 'ios' }] },
        return_event: { name: 'app_open', filters: [{ property: 'plan', op: 'is_set' }] },
      }),
    );
    expect(parsed.return_event?.name).toBe('app_open');
  });

  it.each(['day', 'week'])('accepts interval %p', (interval) => {
    expect(retentionQuerySchema.safeParse(validQuery({ interval })).success).toBe(true);
  });

  it('rejects an unknown interval (e.g. month)', () => {
    expect(retentionQuerySchema.safeParse(validQuery({ interval: 'month' })).success).toBe(false);
  });

  it.each([0, -1, 31, 2.5])('rejects periods out of 1..30 (%p)', (periods) => {
    expect(retentionQuerySchema.safeParse(validQuery({ periods })).success).toBe(false);
  });

  it.each([1, 14, 30])('accepts valid periods %p', (periods) => {
    expect(retentionQuerySchema.safeParse(validQuery({ periods })).success).toBe(true);
  });

  it('rejects a missing born_event', () => {
    const body = validQuery();
    delete (body as { born_event?: unknown }).born_event;
    expect(retentionQuerySchema.safeParse(body).success).toBe(false);
  });

  it('rejects from > to', () => {
    expect(
      retentionQuerySchema.safeParse(
        validQuery({ date_range: { from: '2026-07-02', to: '2026-07-01' } }),
      ).success,
    ).toBe(false);
  });
});
