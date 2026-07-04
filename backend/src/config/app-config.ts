import { z } from 'zod';

export const APP_CONFIG = 'APP_CONFIG';

/** True for an exact 64-char hex string (32 bytes). */
const HEX_64 = /^[0-9a-fA-F]{64}$/;
/** True for a base64 alphabet string (still needs a round-trip check — see decodeKeyBytes). */
const BASE64_CHARS = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decodes a key encoded as either hex or base64 into raw bytes, or `null` if `raw` isn't validly
 * encoded in either format. Base64 is round-tripped (decode then re-encode) because Node's
 * `Buffer.from(str, 'base64')` silently ignores invalid characters instead of throwing, which
 * would otherwise let garbage strings "decode". Exported so callers who need the actual key bytes
 * (e.g. auth's AES-256-GCM helper for TOTP_ENC_KEY) share this exact decoding logic instead of
 * re-implementing it and risking drift.
 */
export function decodeAuthKeyBytes(raw: string): Buffer | null {
  if (HEX_64.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  if (BASE64_CHARS.test(raw) && raw.length % 4 === 0) {
    const decoded = Buffer.from(raw, 'base64');
    const roundTripped = decoded.toString('base64').replace(/=+$/, '');
    if (roundTripped === raw.replace(/=+$/, '')) {
      return decoded;
    }
  }
  return null;
}

/** Byte length of a hex/base64-encoded key, or `null` if `raw` isn't validly encoded. */
function decodeKeyBytes(raw: string): number | null {
  return decodeAuthKeyBytes(raw)?.length ?? null;
}

/** True if `value` parses as a URL whose protocol is one of `schemes` (each without trailing ':'). */
function isUrlWithScheme(value: string, schemes: string[]): boolean {
  try {
    const parsed = new URL(value);
    return schemes.some((scheme) => parsed.protocol === `${scheme}:`);
  } catch {
    return false;
  }
}

/** Environment schema per shared contracts §3 and §11. Unknown keys in process.env are ignored. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// URL'),
  CLICKHOUSE_URL: z
    .string()
    .refine((v) => isUrlWithScheme(v, ['http', 'https']), 'must be a valid http(s) URL'),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_DB: z.string().min(1),
  REDIS_URL: z
    .string()
    .refine((v) => isUrlWithScheme(v, ['redis', 'rediss']), 'must be a valid redis:// URL'),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  INGEST_MAX_BATCH: z.coerce.number().int().positive().default(100),
  INGEST_MAX_BODY_KB: z.coerce.number().int().positive().default(1024),
  // Contracts §4 fixes this at 1000; the env override exists only so tests can exercise 429s cheaply.
  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(1000),
  // §11 — auth & TOTP 2FA.
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
  MFA_TOKEN_TTL: z.coerce.number().int().positive().default(300),
  TOTP_ISSUER: z.string().min(1).default('MyAmpMix'),
  TOTP_ENC_KEY: z.string().optional(),
  COOKIE_SECURE: z.preprocess(
    (v) => (v === undefined ? false : v === 'true' || v === '1'),
    z.boolean(),
  ),
  COOKIE_DOMAIN: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  clickhouse: { url: string; user: string; password: string; database: string };
  redisUrl: string;
  jwtAccessSecret: string | undefined;
  jwtRefreshSecret: string | undefined;
  ingestMaxBatch: number;
  ingestMaxBodyKb: number;
  ingestRateLimitPerMin: number;
  // Optional (rather than required) so pre-existing AppConfig fixtures outside this task's scope
  // (e.g. test/integration/clickhouse.int-spec.ts, owned by concurrent work) keep compiling
  // without every hand-built fixture needing an update. loadConfig() always populates it.
  auth?: {
    accessTokenTtl: number;
    refreshTokenTtl: number;
    mfaTokenTtl: number;
    totpIssuer: string;
    totpEncKey: string | undefined;
    cookieSecure: boolean;
    cookieDomain: string | undefined;
  };
}

/**
 * Cross-field checks that don't map to a single Zod field, so they're evaluated directly against
 * the raw environment rather than through `envSchema.superRefine`. This matters: Zod skips
 * object-level refinements once any field in the object has failed its own validation, which
 * would otherwise hide these problems whenever they co-occur with an unrelated bad var. Reading
 * `env` directly guarantees they always run and always contribute to the aggregated error list.
 */
function collectCrossFieldProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const isTest = env.NODE_ENV === 'test';

  if (!isTest) {
    if (!env.JWT_ACCESS_SECRET) {
      problems.push('JWT_ACCESS_SECRET: is required outside NODE_ENV=test (min 32 chars)');
    }
    if (!env.JWT_REFRESH_SECRET) {
      problems.push('JWT_REFRESH_SECRET: is required outside NODE_ENV=test (min 32 chars)');
    }
    if (!env.TOTP_ENC_KEY) {
      problems.push('TOTP_ENC_KEY: is required outside NODE_ENV=test');
    }
  }

  if (env.TOTP_ENC_KEY && decodeKeyBytes(env.TOTP_ENC_KEY) !== 32) {
    problems.push('TOTP_ENC_KEY: must decode to exactly 32 bytes (64 hex chars or base64)');
  }

  return problems;
}

/**
 * Parses and validates the environment. Aggregates every problem — schema-level (missing,
 * wrong type, failed field rules) and cross-field (secrets required outside test, TOTP key
 * shape) — into a single thrown Error so a misconfigured deploy shows every broken var at once
 * instead of dribbling out one fix-and-retry at a time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  const problems: string[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  problems.push(...collectCrossFieldProblems(env));

  if (problems.length > 0) {
    const details = problems.map((p) => `  ${p}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (!parsed.success) {
    // Unreachable: any schema issue is already in `problems` above, which would have thrown.
    throw new Error('Invalid environment configuration');
  }

  const v = parsed.data;
  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    clickhouse: {
      url: v.CLICKHOUSE_URL,
      user: v.CLICKHOUSE_USER,
      password: v.CLICKHOUSE_PASSWORD,
      database: v.CLICKHOUSE_DB,
    },
    redisUrl: v.REDIS_URL,
    jwtAccessSecret: v.JWT_ACCESS_SECRET,
    jwtRefreshSecret: v.JWT_REFRESH_SECRET,
    ingestMaxBatch: v.INGEST_MAX_BATCH,
    ingestMaxBodyKb: v.INGEST_MAX_BODY_KB,
    ingestRateLimitPerMin: v.INGEST_RATE_LIMIT_PER_MIN,
    auth: {
      accessTokenTtl: v.ACCESS_TOKEN_TTL,
      refreshTokenTtl: v.REFRESH_TOKEN_TTL,
      mfaTokenTtl: v.MFA_TOKEN_TTL,
      totpIssuer: v.TOTP_ISSUER,
      totpEncKey: v.TOTP_ENC_KEY,
      cookieSecure: v.COOKIE_SECURE,
      cookieDomain: v.COOKIE_DOMAIN,
    },
  };
}

const SET = 'set';
const MISSING = 'MISSING';

/** "set" / "MISSING" marker for a secret value — never the value itself. */
function redacted(value: string | undefined): string {
  return value ? SET : MISSING;
}

/** Best-effort host extraction for display; falls back to a placeholder if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

/** Best-effort host + database name for a postgresql:// URL, without ever touching the password. */
function databaseHostAndName(url: string): { host: string; name: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, name: parsed.pathname.replace(/^\//, '') || 'unknown' };
  } catch {
    return { host: 'unknown', name: 'unknown' };
  }
}

/**
 * Print-safe view of the effective config for boot-time logging: non-secret values are shown
 * as-is, and every secret (passwords, JWT secrets, TOTP_ENC_KEY, the full DATABASE_URL) is
 * collapsed to "set" / "MISSING" so operators can confirm what's configured without the actual
 * value ever reaching logs.
 */
export function describeConfig(config: AppConfig): Record<string, string> {
  const db = databaseHostAndName(config.databaseUrl);
  // `auth` is optional on AppConfig only for backward compat with fixtures outside this task's
  // scope; loadConfig() always populates it. Fall back to schema defaults defensively.
  const auth = config.auth ?? {
    accessTokenTtl: 900,
    refreshTokenTtl: 2_592_000,
    mfaTokenTtl: 300,
    totpIssuer: 'MyAmpMix',
    totpEncKey: undefined,
    cookieSecure: false,
    cookieDomain: undefined,
  };
  return {
    NODE_ENV: config.nodeEnv,
    PORT: String(config.port),
    DATABASE_HOST: db.host,
    DATABASE_NAME: db.name,
    DATABASE_URL: redacted(config.databaseUrl),
    CLICKHOUSE_URL: config.clickhouse.url,
    CLICKHOUSE_DB: config.clickhouse.database,
    CLICKHOUSE_PASSWORD: redacted(config.clickhouse.password),
    REDIS_HOST: hostOf(config.redisUrl),
    JWT_ACCESS_SECRET: redacted(config.jwtAccessSecret),
    JWT_REFRESH_SECRET: redacted(config.jwtRefreshSecret),
    INGEST_MAX_BATCH: String(config.ingestMaxBatch),
    INGEST_MAX_BODY_KB: String(config.ingestMaxBodyKb),
    INGEST_RATE_LIMIT_PER_MIN: String(config.ingestRateLimitPerMin),
    TOTP_ISSUER: auth.totpIssuer,
    TOTP_ENC_KEY: redacted(auth.totpEncKey),
    ACCESS_TOKEN_TTL: String(auth.accessTokenTtl),
    REFRESH_TOKEN_TTL: String(auth.refreshTokenTtl),
    MFA_TOKEN_TTL: String(auth.mfaTokenTtl),
    COOKIE_SECURE: String(auth.cookieSecure),
    COOKIE_DOMAIN: auth.cookieDomain ?? '(not set)',
  };
}
