import { AppConfig } from '../../config/app-config';

/** Shared `AppConfig` builder for auth unit tests — keeps every spec file's fixture in sync. */
export function makeAuthTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    databaseUrl: 'postgresql://x',
    clickhouse: { url: 'http://x', user: 'u', password: 'p', database: 'd' },
    redisUrl: 'redis://x',
    jwtAccessSecret: 'access-secret-'.repeat(3),
    jwtRefreshSecret: 'refresh-secret-'.repeat(3),
    ingestMaxBatch: 100,
    ingestMaxBodyKb: 1024,
    ingestRateLimitPerMin: 1000,
    auth: {
      accessTokenTtl: 900,
      refreshTokenTtl: 2_592_000,
      mfaTokenTtl: 300,
      totpIssuer: 'MyAmpMix',
      totpEncKey: 'c'.repeat(64),
      cookieSecure: false,
      cookieDomain: undefined,
    },
    ...overrides,
  };
}
