import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgresql://u:p@h:5432/admin_console' };

describe('loadEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = loadEnv(base as unknown as NodeJS.ProcessEnv);
    expect(env.SESSION_IDLE_HOURS).toBe(12);
    expect(env.SESSION_ABSOLUTE_DAYS).toBe(7);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.CLICKHOUSE_USER).toBe('default');
  });

  it('aggregates every problem into one error', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'mysql://nope', SESSION_IDLE_HOURS: '-1' } as unknown as NodeJS.ProcessEnv),
    ).toThrowError(/DATABASE_URL[\s\S]*SESSION_IDLE_HOURS/);
  });

  it('parses COOKIE_SECURE truthy forms', () => {
    expect(loadEnv({ ...base, COOKIE_SECURE: 'true' } as unknown as NodeJS.ProcessEnv).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...base, COOKIE_SECURE: '1' } as unknown as NodeJS.ProcessEnv).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...base, COOKIE_SECURE: 'false' } as unknown as NodeJS.ProcessEnv).COOKIE_SECURE).toBe(false);
  });
});
