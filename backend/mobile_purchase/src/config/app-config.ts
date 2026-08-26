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
  // Encryption key for App.storeCredentials (encrypted-at-rest, populated by the connect-store
  // flow). Optional at boot — absence only fails the connect path, not startup. When present it
  // must be a base64 value that decodes to exactly 32 bytes (AES-256), validated here so a
  // misconfigured key fails fast instead of at first encrypt. `.optional()` after `.refine()` so
  // an unset var short-circuits before the refine ever runs.
  STORE_CREDENTIALS_ENC_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'must be a base64-encoded 32-byte key',
    )
    .optional(),
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
  // Google Pub/Sub push auth mode (design §1.2/§6/§10) — `oidc` is deferred to X1 (see
  // google-oidc-authenticator.ts) and always fails closed today; `shared_secret` is the working
  // pre-deploy mode. Default matches the design's "shared-secret acceptable for early sandbox".
  GOOGLE_PUSH_AUTH_MODE: z.enum(['shared_secret', 'oidc']).default('shared_secret'),
  // High-entropy shared-secret token for Google Pub/Sub push auth (?token=... query param,
  // constant-time compared). No dev default on purpose — unset means every Google push is
  // rejected (401), never a fail-open default (design brief's non-negotiable).
  GOOGLE_PUBSUB_SHARED_SECRET: z.string().optional(),
  // CORS allowlist for the dashboard→mobile_purchase reach (design §2): comma-separated list of
  // dashboard origin(s) permitted to send credentialed (Authorization) cross-origin requests. Dev
  // default is the dashboard dev server origin (dashboard/vite.config.ts); X1 sets the prod
  // origin(s). Empty → no origin is allowed (CORS effectively closed).
  DASHBOARD_ORIGINS: z.string().default('http://localhost:5173'),
  // Scheduler (D2): master on/off for the @nestjs/schedule crons. Default on; set 'false' to
  // register no jobs (tests + a future split worker opt out this way).
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),
  // Cron expression for the subscription-expiry sweep (design §1). Default every 5 minutes —
  // RC-faithful promptness without load. The `cron` lib validates the expression at job construction.
  EXPIRY_SWEEP_CRON: z.string().min(1).default('*/5 * * * *'),
  // End-user data erasure (account deletion / GDPR): shared secret that DELETE
  // /v1/subscribers/:appUserId requires IN ADDITION to a valid public SDK key. The public key
  // ships inside the mobile app, so it alone must never authorize destructive deletes. Unset ⇒
  // the erasure endpoint is disabled (403) — fail closed, never fail open.
  ERASURE_API_KEY: z.string().min(16, 'must be at least 16 characters').optional(),
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
  // Google Pub/Sub push auth config — see envSchema comments above. loadConfig() always populates
  // googlePushAuthMode (schema default 'shared_secret'); optional here for the same hand-built-
  // fixture-compatibility reason as the Apple fields (e.g. project-access.service.spec.ts's
  // makeConfig()). googlePubsubSharedSecret stays optional/undefined until configured either way.
  googlePushAuthMode?: 'shared_secret' | 'oidc';
  googlePubsubSharedSecret?: string;
  // CORS allowlist — see envSchema comment above. Optional for the same hand-built-fixture-
  // compatibility reason as the Apple/Google fields; loadConfig() always populates it.
  dashboardOrigins?: string[];
  // Scheduler config (D2) — see envSchema comments. Optional for the same hand-built-fixture-
  // compatibility reason as the Apple/Google fields; loadConfig() always populates both.
  schedulerEnabled?: boolean;
  expirySweepCron?: string;
  // End-user data erasure shared secret — see envSchema comment. Optional both because the
  // feature is opt-in (unset ⇒ endpoint disabled) and for the usual hand-built-fixture-
  // compatibility reason; loadConfig() always populates it (to undefined when unset).
  erasureApiKey?: string;
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
    googlePushAuthMode: v.GOOGLE_PUSH_AUTH_MODE,
    googlePubsubSharedSecret: v.GOOGLE_PUBSUB_SHARED_SECRET,
    dashboardOrigins: v.DASHBOARD_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    schedulerEnabled: v.SCHEDULER_ENABLED === 'true',
    expirySweepCron: v.EXPIRY_SWEEP_CRON,
    erasureApiKey: v.ERASURE_API_KEY,
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
    GOOGLE_PUSH_AUTH_MODE: config.googlePushAuthMode ?? 'shared_secret',
    GOOGLE_PUBSUB_SHARED_SECRET: redacted(config.googlePubsubSharedSecret),
    DASHBOARD_ORIGINS: (config.dashboardOrigins ?? []).join(',') || 'MISSING',
    SCHEDULER_ENABLED: String(config.schedulerEnabled ?? true),
    EXPIRY_SWEEP_CRON: config.expirySweepCron ?? '*/5 * * * *',
    ERASURE_API_KEY: redacted(config.erasureApiKey),
  };
}
