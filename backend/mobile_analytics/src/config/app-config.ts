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

/**
 * Same truthy parsing COOKIE_SECURE's Zod preprocess (below) uses for the raw env string.
 * Shared so the schema-level coercion and the cross-field production check can never drift.
 */
function isCookieSecureTruthy(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
}

/** Environment schema per shared contracts §3 and §11. Unknown keys in process.env are ignored. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(8088),
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
  // §18 — per-upload cap for automatic screenshots (JPEG bytes). Default 512 KB.
  SCREENSHOT_MAX_KB: z.coerce.number().int().positive().default(512),
  // §18 — Firebase Storage (GCS) bucket the screenshot bytes are written to. When unset the app
  // falls back to an in-memory fake store (dev/test) and logs a warning. Credentials come from
  // GOOGLE_APPLICATION_CREDENTIALS (service-account JSON path) or Application Default Credentials,
  // both read directly from the environment by firebase-admin.
  FIREBASE_STORAGE_BUCKET: z.string().min(1).optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  // §11 — auth & TOTP 2FA.
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
  MFA_TOKEN_TTL: z.coerce.number().int().positive().default(300),
  TOTP_ISSUER: z.string().min(1).default('MyAmpix'),
  TOTP_ENC_KEY: z.string().optional(),
  COOKIE_SECURE: z.preprocess(
    (v) => (v === undefined ? false : isCookieSecureTruthy(v as string)),
    z.boolean(),
  ),
  COOKIE_DOMAIN: z.string().optional(),
  // §20 — pino base log level. At the default `info`, successful (2xx/3xx) request logs are
  // suppressed (app.module maps them to `debug` via customLogLevel) while app logs (info) and
  // 4xx/5xx request logs still surface. Raise to `debug`/`trace` to see successful-request logs.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Self-hosted instances often want a closed door: 'false' disables POST /api/v1/auth/signup
  // (403) and the dashboard hides its register page. Existing accounts and invites-between-existing
  // -users are unaffected; new people are then created via scripts/create-account (see SETUP.md §7).
  SIGNUP_ENABLED: z.enum(['true', 'false']).default('true'),
  // feat-17 §3.1 — "Ask your data". Both optional: no key means the feature is simply
  // "unconfigured" (MistralService maps this to a 503, not a boot-time config error).
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().default('mistral-small-latest'),
  // End-user data erasure (account deletion / GDPR): shared secret that DELETE
  // /ingest/users/:distinctId requires IN ADDITION to a valid SDK token. The SDK token ships
  // inside the mobile app, so it alone must never authorize destructive deletes. Unset ⇒ the
  // erasure endpoint is disabled (403) — fail closed, never fail open.
  ERASURE_API_KEY: z.string().min(16, 'must be at least 16 characters').optional(),
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
  screenshotMaxKb: number;
  // Optional so pre-existing AppConfig fixtures keep compiling; loadConfig always populates it
  // (to undefined when unset → the in-memory screenshot store fallback kicks in).
  firebaseStorageBucket?: string;
  // feat-17 §3.1 — "Ask your data" (Mistral). Optional (rather than required) so pre-existing
  // hand-built AppConfig fixtures outside this task's scope keep compiling without every fixture
  // needing an update; loadConfig() always populates both (mistralModel via its zod default).
  mistralApiKey?: string;
  mistralModel?: string;
  // End-user data erasure shared secret — see envSchema comment. Optional both because the
  // feature is opt-in (unset ⇒ endpoint disabled) and for the usual hand-built-fixture
  // compatibility; loadConfig() always populates it (to undefined when unset).
  erasureApiKey?: string;
  // §20 — pino base log level. Optional (rather than required) so pre-existing hand-built AppConfig
  // fixtures outside this task's scope (e.g. test/integration/clickhouse.int-spec.ts) keep compiling
  // without every fixture needing an update. loadConfig() always populates it (default 'info').
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  // Optional (fixture-compat convention, see logLevel above); loadConfig() always populates it.
  // false ⇒ the signup endpoint answers 403 and the dashboard hides registration.
  signupEnabled?: boolean;
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

  // The refresh cookie (contracts §11) must never be sent over plaintext HTTP. Dev defaults to
  // false for localhost convenience, but a production deploy that leaves COOKIE_SECURE unset/false
  // is a real vulnerability (session hijacking over an unencrypted network), not just a footgun —
  // so it's a hard config error here rather than a silent default.
  if (env.NODE_ENV === 'production' && !isCookieSecureTruthy(env.COOKIE_SECURE)) {
    problems.push(
      'COOKIE_SECURE: must be true in production (the refresh cookie must never be sent over plaintext HTTP)',
    );
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

  // Development convenience: short-lived access tokens mean a long coding session keeps bouncing you
  // back to the login screen. Unless the operator has explicitly pinned the TTLs, dev issues
  // long-lived tokens so a working session survives the day (and page reloads, via the refresh
  // cookie). Production and any explicit ACCESS_TOKEN_TTL/REFRESH_TOKEN_TTL override are untouched.
  const isDev = v.NODE_ENV === 'development';
  const DEV_ACCESS_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
  const DEV_REFRESH_TOKEN_TTL = 60 * 60 * 24 * 365; // 1 year
  const accessTokenTtl =
    isDev && env.ACCESS_TOKEN_TTL === undefined ? DEV_ACCESS_TOKEN_TTL : v.ACCESS_TOKEN_TTL;
  const refreshTokenTtl =
    isDev && env.REFRESH_TOKEN_TTL === undefined ? DEV_REFRESH_TOKEN_TTL : v.REFRESH_TOKEN_TTL;

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
    screenshotMaxKb: v.SCREENSHOT_MAX_KB,
    firebaseStorageBucket: v.FIREBASE_STORAGE_BUCKET,
    logLevel: v.LOG_LEVEL,
    signupEnabled: v.SIGNUP_ENABLED === 'true',
    mistralApiKey: v.MISTRAL_API_KEY,
    mistralModel: v.MISTRAL_MODEL,
    erasureApiKey: v.ERASURE_API_KEY,
    auth: {
      accessTokenTtl,
      refreshTokenTtl,
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
    totpIssuer: 'MyAmpix',
    totpEncKey: undefined,
    cookieSecure: false,
    cookieDomain: undefined,
  };
  return {
    NODE_ENV: config.nodeEnv,
    LOG_LEVEL: config.logLevel ?? 'info',
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
    SCREENSHOT_MAX_KB: String(config.screenshotMaxKb),
    FIREBASE_STORAGE_BUCKET:
      config.firebaseStorageBucket ?? '(not set — in-memory screenshot store)',
    MISTRAL_API_KEY: redacted(config.mistralApiKey),
    MISTRAL_MODEL: config.mistralModel ?? 'mistral-small-latest',
    ERASURE_API_KEY: redacted(config.erasureApiKey),
    TOTP_ISSUER: auth.totpIssuer,
    TOTP_ENC_KEY: redacted(auth.totpEncKey),
    ACCESS_TOKEN_TTL: String(auth.accessTokenTtl),
    REFRESH_TOKEN_TTL: String(auth.refreshTokenTtl),
    MFA_TOKEN_TTL: String(auth.mfaTokenTtl),
    COOKIE_SECURE: String(auth.cookieSecure),
    COOKIE_DOMAIN: auth.cookieDomain ?? '(not set)',
  };
}
