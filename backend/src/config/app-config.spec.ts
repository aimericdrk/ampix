import { loadConfig } from './app-config';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://myampmix:myampmix_dev@localhost:5432/myampmix',
  CLICKHOUSE_URL: 'http://localhost:8123',
  CLICKHOUSE_USER: 'default',
  CLICKHOUSE_PASSWORD: 'myampmix_dev',
  CLICKHOUSE_DB: 'analytics',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('loadConfig', () => {
  it('parses a valid environment and applies contract defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.ingestMaxBatch).toBe(100);
    expect(config.ingestMaxBodyKb).toBe(1024);
    expect(config.ingestRateLimitPerMin).toBe(1000);
    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.clickhouse).toEqual({
      url: 'http://localhost:8123',
      user: 'default',
      password: 'myampmix_dev',
      database: 'analytics',
    });
  });

  it('coerces numeric env vars from strings', () => {
    const config = loadConfig({ ...validEnv, PORT: '9090', INGEST_MAX_BATCH: '50' });
    expect(config.port).toBe(9090);
    expect(config.ingestMaxBatch).toBe(50);
  });

  it('crashes with a clear message naming the missing var', () => {
    const { DATABASE_URL, ...withoutDb } = validEnv;
    expect(() => loadConfig(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });

  it('requires JWT secrets outside NODE_ENV=test', () => {
    const { JWT_ACCESS_SECRET, ...withoutJwt } = validEnv;
    expect(() => loadConfig(withoutJwt)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('allows missing JWT secrets when NODE_ENV=test', () => {
    const { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ...rest } = validEnv;
    expect(() => loadConfig({ ...rest, NODE_ENV: 'test' })).not.toThrow();
  });

  it('rejects JWT secrets shorter than 32 chars', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
