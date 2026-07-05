import { describeConfig, loadConfig } from './app-config';

const validTotpEncKey = '9d3383ee2d0de7feb67f8e677e9c6e676b217df5aeff883d13783788db4b3d46';

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
  TOTP_ENC_KEY: validTotpEncKey,
  // NODE_ENV is 'production' above, which now requires this to be true (see the "COOKIE_SECURE in
  // production" describe block below) — set here so every other test in this file, which isn't
  // concerned with cookie-secure enforcement, keeps passing unmodified.
  COOKIE_SECURE: 'true',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies contract defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.ingestMaxBatch).toBe(100);
    expect(config.ingestMaxBodyKb).toBe(1024);
    expect(config.ingestRateLimitPerMin).toBe(1000);
    expect(config.screenshotMaxKb).toBe(512);
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

  it('overrides SCREENSHOT_MAX_KB when set and rejects a non-positive value (§18)', () => {
    expect(loadConfig({ ...validEnv, SCREENSHOT_MAX_KB: '256' }).screenshotMaxKb).toBe(256);
    expect(() => loadConfig({ ...validEnv, SCREENSHOT_MAX_KB: '0' })).toThrow(/SCREENSHOT_MAX_KB/);
  });

  it('reads FIREBASE_STORAGE_BUCKET, defaulting to undefined (§18 in-memory fallback)', () => {
    expect(loadConfig(validEnv).firebaseStorageBucket).toBeUndefined();
    expect(
      loadConfig({ ...validEnv, FIREBASE_STORAGE_BUCKET: 'my-app.appspot.com' }).firebaseStorageBucket,
    ).toBe('my-app.appspot.com');
  });

  describe('§20 LOG_LEVEL', () => {
    it('defaults to info when unset', () => {
      expect(loadConfig(validEnv).logLevel).toBe('info');
    });

    it('accepts every valid pino level', () => {
      for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const) {
        expect(loadConfig({ ...validEnv, LOG_LEVEL: level }).logLevel).toBe(level);
      }
    });

    it('rejects an unknown level', () => {
      expect(() => loadConfig({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
    });

    it('is surfaced in the redacted describe output', () => {
      expect(describeConfig(loadConfig({ ...validEnv, LOG_LEVEL: 'debug' })).LOG_LEVEL).toBe('debug');
    });
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
    const { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOTP_ENC_KEY, ...rest } = validEnv;
    expect(() => loadConfig({ ...rest, NODE_ENV: 'test' })).not.toThrow();
  });

  it('rejects JWT secrets shorter than 32 chars', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  describe('error aggregation', () => {
    it('lists every broken var in a single thrown error, not just the first', () => {
      const broken: NodeJS.ProcessEnv = {
        ...validEnv,
        DATABASE_URL: 'mysql://nope',
        JWT_ACCESS_SECRET: 'short',
        CLICKHOUSE_URL: 'not-a-url',
      };
      let message = '';
      try {
        loadConfig(broken);
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).toMatch(/CLICKHOUSE_URL/);
    });

    it('aggregates schema-level and cross-field problems together', () => {
      // DATABASE_URL is entirely missing (schema-level) AND JWT_ACCESS_SECRET is missing
      // (cross-field, since NODE_ENV !== test) — both must appear in the one thrown error.
      const { DATABASE_URL, JWT_ACCESS_SECRET, ...rest } = validEnv;
      let message = '';
      try {
        loadConfig(rest);
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
    });
  });

  describe('semantic validation', () => {
    it('rejects a CLICKHOUSE_URL with the wrong scheme', () => {
      expect(() => loadConfig({ ...validEnv, CLICKHOUSE_URL: 'ftp://localhost:8123' })).toThrow(
        /CLICKHOUSE_URL/,
      );
    });

    it('rejects an unparseable CLICKHOUSE_URL', () => {
      expect(() => loadConfig({ ...validEnv, CLICKHOUSE_URL: 'not a url' })).toThrow(
        /CLICKHOUSE_URL/,
      );
    });

    it('rejects a REDIS_URL with the wrong scheme', () => {
      expect(() => loadConfig({ ...validEnv, REDIS_URL: 'http://localhost:6379' })).toThrow(
        /REDIS_URL/,
      );
    });

    it('accepts a rediss:// REDIS_URL', () => {
      expect(() => loadConfig({ ...validEnv, REDIS_URL: 'rediss://localhost:6380' })).not.toThrow();
    });

    it('rejects non-positive-integer numeric vars', () => {
      expect(() => loadConfig({ ...validEnv, PORT: '0' })).toThrow(/PORT/);
      expect(() => loadConfig({ ...validEnv, INGEST_MAX_BATCH: '-5' })).toThrow(/INGEST_MAX_BATCH/);
      expect(() => loadConfig({ ...validEnv, ACCESS_TOKEN_TTL: '0' })).toThrow(/ACCESS_TOKEN_TTL/);
    });

    it('rejects a TOTP_ENC_KEY that does not decode to exactly 32 bytes', () => {
      expect(() => loadConfig({ ...validEnv, TOTP_ENC_KEY: 'tooshort' })).toThrow(/TOTP_ENC_KEY/);
      // 16 bytes hex-encoded (32 hex chars) — wrong length, not wrong format.
      expect(() => loadConfig({ ...validEnv, TOTP_ENC_KEY: 'a'.repeat(32) })).toThrow(
        /TOTP_ENC_KEY/,
      );
    });

    it('accepts a base64-encoded 32-byte TOTP_ENC_KEY', () => {
      const base64Key = Buffer.alloc(32, 7).toString('base64');
      expect(() => loadConfig({ ...validEnv, TOTP_ENC_KEY: base64Key })).not.toThrow();
    });

    it('requires TOTP_ENC_KEY outside NODE_ENV=test', () => {
      const { TOTP_ENC_KEY, ...withoutKey } = validEnv;
      expect(() => loadConfig(withoutKey)).toThrow(/TOTP_ENC_KEY/);
    });
  });

  describe('§11 auth/2FA defaults', () => {
    it('applies the documented TTL/issuer defaults when unset', () => {
      const config = loadConfig(validEnv);
      expect(config.auth).toEqual({
        accessTokenTtl: 900,
        refreshTokenTtl: 2_592_000,
        mfaTokenTtl: 300,
        totpIssuer: 'MyAmpMix',
        totpEncKey: validTotpEncKey,
        // validEnv sets this explicitly (NODE_ENV=production requires it) — see the dedicated
        // "defaults to false outside production" test below for the actual default-value behavior.
        cookieSecure: true,
        cookieDomain: undefined,
      });
    });

    it('defaults COOKIE_SECURE to false when unset outside production', () => {
      const { COOKIE_SECURE, ...rest } = validEnv;
      const config = loadConfig({ ...rest, NODE_ENV: 'development' });
      expect(config.auth!.cookieSecure).toBe(false);
    });

    it('coerces COOKIE_SECURE from a string and honors an explicit COOKIE_DOMAIN', () => {
      const config = loadConfig({
        ...validEnv,
        COOKIE_SECURE: 'true',
        COOKIE_DOMAIN: '.myampmix.com',
      });
      // loadConfig always populates `auth`; non-null assertion reflects that guarantee (the
      // type is optional only to avoid breaking AppConfig fixtures outside this task's scope).
      expect(config.auth!.cookieSecure).toBe(true);
      expect(config.auth!.cookieDomain).toBe('.myampmix.com');
    });

    it('overrides TTLs and issuer when explicitly set', () => {
      const config = loadConfig({
        ...validEnv,
        ACCESS_TOKEN_TTL: '60',
        REFRESH_TOKEN_TTL: '120',
        MFA_TOKEN_TTL: '30',
        TOTP_ISSUER: 'CustomIssuer',
      });
      expect(config.auth!.accessTokenTtl).toBe(60);
      expect(config.auth!.refreshTokenTtl).toBe(120);
      expect(config.auth!.mfaTokenTtl).toBe(30);
      expect(config.auth!.totpIssuer).toBe('CustomIssuer');
    });
  });

  describe('COOKIE_SECURE enforcement in production (security hardening)', () => {
    it('rejects production config with COOKIE_SECURE=false', () => {
      expect(() => loadConfig({ ...validEnv, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    });

    it('rejects production config with COOKIE_SECURE unset (defaults false)', () => {
      const { COOKIE_SECURE, ...rest } = validEnv;
      expect(() => loadConfig(rest)).toThrow(/COOKIE_SECURE/);
    });

    it('accepts production config with COOKIE_SECURE=true', () => {
      expect(() => loadConfig({ ...validEnv, COOKIE_SECURE: 'true' })).not.toThrow();
    });

    it('does not require COOKIE_SECURE outside production — dev keeps the false default', () => {
      const { COOKIE_SECURE, ...rest } = validEnv;
      const config = loadConfig({ ...rest, NODE_ENV: 'development' });
      expect(config.auth!.cookieSecure).toBe(false);
    });

    it('does not require COOKIE_SECURE under NODE_ENV=test', () => {
      const { COOKIE_SECURE, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOTP_ENC_KEY, ...rest } =
        validEnv;
      expect(() => loadConfig({ ...rest, NODE_ENV: 'test' })).not.toThrow();
    });
  });

  describe('describeConfig', () => {
    it('never leaks secret values, and always shows PORT/NODE_ENV', () => {
      const config = loadConfig(validEnv);
      const description = describeConfig(config);
      const serialized = JSON.stringify(description);

      // Known secrets must never appear anywhere in the redacted view.
      expect(serialized).not.toContain(validEnv.CLICKHOUSE_PASSWORD);
      expect(serialized).not.toContain(validEnv.JWT_ACCESS_SECRET);
      expect(serialized).not.toContain(validEnv.JWT_REFRESH_SECRET);
      expect(serialized).not.toContain(validTotpEncKey);
      expect(serialized).not.toContain(validEnv.DATABASE_URL as string);
      // The password embedded in DATABASE_URL specifically must not leak either.
      expect(serialized).not.toContain('myampmix_dev');

      // Secrets are marked set/MISSING, never left out silently.
      expect(description.JWT_ACCESS_SECRET).toBe('set');
      expect(description.JWT_REFRESH_SECRET).toBe('set');
      expect(description.TOTP_ENC_KEY).toBe('set');
      expect(description.CLICKHOUSE_PASSWORD).toBe('set');
      expect(description.DATABASE_URL).toBe('set');

      // Non-secret operational values are present for boot-time debugging.
      expect(description.PORT).toBe('8080');
      expect(description.NODE_ENV).toBe('production');
      expect(description.CLICKHOUSE_URL).toBe('http://localhost:8123');
      expect(description.CLICKHOUSE_DB).toBe('analytics');
      expect(description.DATABASE_HOST).toBe('localhost:5432');
      expect(description.DATABASE_NAME).toBe('myampmix');
    });

    it('reports MISSING for secrets that were never set (test env)', () => {
      const { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOTP_ENC_KEY, ...rest } = validEnv;
      const config = loadConfig({ ...rest, NODE_ENV: 'test' });
      const description = describeConfig(config);
      expect(description.JWT_ACCESS_SECRET).toBe('MISSING');
      expect(description.JWT_REFRESH_SECRET).toBe('MISSING');
      expect(description.TOTP_ENC_KEY).toBe('MISSING');
    });
  });
});
