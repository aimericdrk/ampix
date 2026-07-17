import { metricsQuerySchema } from './metrics.schemas';

describe('metricsQuerySchema', () => {
  it('applies defaults: 30-day window, day granularity, PRODUCTION env', () => {
    const parsed = metricsQuerySchema.parse({});
    expect(parsed.granularity).toBe('day');
    expect(parsed.environment).toBe('PRODUCTION');
    expect(parsed.to.getTime() - parsed.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('coerces from/to to Dates and preserves granularity/environment', () => {
    const parsed = metricsQuerySchema.parse({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-31T00:00:00Z',
      granularity: 'week',
      environment: 'SANDBOX',
    });
    expect(parsed.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(parsed.to.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(parsed.granularity).toBe('week');
    expect(parsed.environment).toBe('SANDBOX');
  });

  it('rejects from-after-to, an unknown granularity, and a non-date from', () => {
    expect(metricsQuerySchema.safeParse({ from: '2026-08-01T00:00:00Z', to: '2026-07-01T00:00:00Z' }).success).toBe(false);
    expect(metricsQuerySchema.safeParse({ granularity: 'hour' }).success).toBe(false);
    expect(metricsQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false);
  });
});
