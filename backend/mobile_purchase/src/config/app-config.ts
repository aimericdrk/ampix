import { z } from 'zod';

export const APP_CONFIG = 'APP_CONFIG';

/** Environment schema for the mobile-purchase service. Unknown keys in process.env are ignored. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(8090),
  DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// URL'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Cross-service authz seam (contracts: mobile_purchase holds NO JWT secret): base URL of the
  // analytics backend's internal role-resolution endpoint. Default matches its local dev PORT.
  ANALYTICS_INTERNAL_URL: z
    .string()
    .refine((value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }, 'must be a valid URL')
    .default('http://localhost:8088'),
  // Encryption key for App.storeCredentials (encrypted-at-rest, populated by a later
  // connect-store flow). Optional here: P0 ships the column, not the writer.
  STORE_CREDENTIALS_ENC_KEY: z.string().optional(),
  // Apple ASSN v2 verifier config (design §1.1/§8). M2a is single-tenant/config-driven (no
  // App-by-bundleId DB resolution yet — that is M2b); comma-separated so more than one bundleId
  // can be accepted meanwhile. Dev default is an obviously-fake placeholder, never a real app.
  APPLE_BUNDLE_IDS: z.string().default('com.myampix.app'),
  // The app's numeric App Store Connect id. Apple's library requires this for the Production
  // environment (omitted/undefined is valid, and required, for Sandbox-only verification).
  APPLE_APP_APPLE_ID: z.coerce.number().int().positive().optional(),
  // Directory of trust-anchor root certs (PEM or DER) for AppleNotificationVerifier — see
  // src/webhooks/apple/certs/README.md. Optional: unset falls back to the in-repo certs/ dir
  // next to the verifier (src or dist, resolved via __dirname so it works either way).
  APPLE_ROOT_CERT_DIR: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  analyticsInternalUrl: string;
  // Optional (rather than required) so pre-existing hand-built AppConfig fixtures outside this
  // task's scope keep compiling without every fixture needing an update. loadConfig() always
  // populates it (to undefined when unset).
  storeCredentialsEncKey?: string;
  // Apple ASSN v2 verifier config — see envSchema comments above. Optional for the same
  // hand-built-fixture-compatibility reason as storeCredentialsEncKey.
  appleBundleIds?: string[];
  appleAppAppleId?: number;
  appleRootCertDir?: string;
}

/**
 * Parses and validates the environment. Aggregates every schema problem into a single thrown
 * Error so a misconfigured deploy shows every broken var at once instead of dribbling out one
 * fix-and-retry at a time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    const details = problems.map((p) => `  ${p}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const v = parsed.data;

  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    logLevel: v.LOG_LEVEL,
    analyticsInternalUrl: v.ANALYTICS_INTERNAL_URL,
    storeCredentialsEncKey: v.STORE_CREDENTIALS_ENC_KEY,
    appleBundleIds: v.APPLE_BUNDLE_IDS.split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    appleAppAppleId: v.APPLE_APP_APPLE_ID,
    appleRootCertDir: v.APPLE_ROOT_CERT_DIR,
  };
}

const SET = 'set';
const MISSING = 'MISSING';

/** "set" / "MISSING" marker for a secret value — never the value itself. */
function redacted(value: string | undefined): string {
  return value ? SET : MISSING;
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
 * as-is, and the full DATABASE_URL is collapsed to "set" so operators can confirm what's
 * configured without the actual value (which embeds the DB password) ever reaching logs.
 */
export function describeConfig(config: AppConfig): Record<string, string> {
  const db = databaseHostAndName(config.databaseUrl);
  return {
    NODE_ENV: config.nodeEnv,
    LOG_LEVEL: config.logLevel,
    PORT: String(config.port),
    DATABASE_HOST: db.host,
    DATABASE_NAME: db.name,
    DATABASE_URL: redacted(config.databaseUrl),
    ANALYTICS_INTERNAL_URL: config.analyticsInternalUrl,
    APPLE_BUNDLE_IDS: (config.appleBundleIds ?? []).join(',') || 'MISSING',
    APPLE_ROOT_CERT_DIR: config.appleRootCertDir ?? '(default: certs/ next to the verifier)',
  };
}
