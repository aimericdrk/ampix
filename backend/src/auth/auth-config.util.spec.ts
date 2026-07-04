import { AppConfig } from '../config/app-config';
import {
  requireAccessSecret,
  requireAuthConfig,
  requireMfaSecret,
  requireTotpEncKey,
} from './auth-config.util';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    databaseUrl: 'postgresql://x',
    clickhouse: { url: 'http://x', user: 'u', password: 'p', database: 'd' },
    redisUrl: 'redis://x',
    jwtAccessSecret: 'a'.repeat(32),
    jwtRefreshSecret: 'b'.repeat(32),
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

describe('auth-config.util', () => {
  it('requireAuthConfig returns the populated auth block', () => {
    const config = baseConfig();
    expect(requireAuthConfig(config)).toBe(config.auth);
  });

  it('requireAuthConfig throws when auth is missing (should never happen post-loadConfig)', () => {
    const config = baseConfig({ auth: undefined });
    expect(() => requireAuthConfig(config)).toThrow(/AppConfig\.auth/);
  });

  it('requireAccessSecret returns the secret when set, throws when missing', () => {
    expect(requireAccessSecret(baseConfig())).toBe('a'.repeat(32));
    expect(() => requireAccessSecret(baseConfig({ jwtAccessSecret: undefined }))).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('requireMfaSecret returns JWT_REFRESH_SECRET when set, throws when missing', () => {
    expect(requireMfaSecret(baseConfig())).toBe('b'.repeat(32));
    expect(() => requireMfaSecret(baseConfig({ jwtRefreshSecret: undefined }))).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('requireTotpEncKey returns the key when set, throws when missing', () => {
    expect(requireTotpEncKey(baseConfig())).toBe('c'.repeat(64));
    const config = baseConfig();
    config.auth!.totpEncKey = undefined;
    expect(() => requireTotpEncKey(config)).toThrow(/TOTP_ENC_KEY/);
  });
});
