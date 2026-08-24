import { z } from 'zod';

/**
 * Environment schema (design §5). Parsed once, lazily, so `next build` (which imports route modules
 * without a real environment) never crashes — anything touching env at runtime calls loadEnv().
 * Every problem is aggregated into a single error, mirroring the backend services' convention.
 */
const boolish = z.preprocess((v) => v === 'true' || v === '1', z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// URL'),
  // Optional probe targets — each unset value simply disables that probe/tile.
  ANALYTICS_DATABASE_URL: z.string().regex(/^postgresql:\/\//).optional(),
  PURCHASE_DATABASE_URL: z.string().regex(/^postgresql:\/\//).optional(),
  CLICKHOUSE_URL: z.string().url().optional(),
  CLICKHOUSE_USER: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().optional(),
  ANALYTICS_INTERNAL_URL: z.string().url().optional(),
  PURCHASE_INTERNAL_URL: z.string().url().optional(),
  // Unix socket path for the host Docker daemon; empty/unset disables the Docker page's data.
  DOCKER_SOCK: z.string().optional(),
  COOKIE_SECURE: boolish.default(false),
  SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(7),
});

export type AdminEnv = z.infer<typeof envSchema>;

let cached: AdminEnv | undefined;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AdminEnv {
  if (cached && env === process.env) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid admin console environment:\n  - ${problems.join('\n  - ')}`);
  }
  if (env === process.env) cached = parsed.data;
  return parsed.data;
}

/** Test seam: forget the cached env. */
export function resetEnvCache(): void {
  cached = undefined;
}
