import { z } from 'zod';

export const APP_CONFIG = 'APP_CONFIG';

/** Environment schema for the mobile-purchase service. Unknown keys in process.env are ignored. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(8090),
  DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// URL'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
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
  };
}
