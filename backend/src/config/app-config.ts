import { z } from 'zod';

export const APP_CONFIG = 'APP_CONFIG';

/** Environment schema per shared contracts §3. Unknown keys in process.env are ignored. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// URL'),
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_DB: z.string().min(1),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  INGEST_MAX_BATCH: z.coerce.number().int().positive().default(100),
  INGEST_MAX_BODY_KB: z.coerce.number().int().positive().default(1024),
  // Contracts §4 fixes this at 1000; the env override exists only so tests can exercise 429s cheaply.
  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(1000),
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
}

/** Parses and validates the environment. Throws (crashing boot) on any invalid/missing var. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const v = parsed.data;
  if (v.NODE_ENV !== 'test' && (!v.JWT_ACCESS_SECRET || !v.JWT_REFRESH_SECRET)) {
    throw new Error(
      'Invalid environment configuration:\n  JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (min 32 chars) are required outside NODE_ENV=test',
    );
  }
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
  };
}
