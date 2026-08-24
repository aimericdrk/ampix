import { Client as PgClient } from 'pg';
import { createClient as createClickHouse } from '@clickhouse/client';
import Redis from 'ioredis';
import { loadEnv } from './env';

/**
 * Direct datastore probes (design §4). Every probe is independently bounded by PROBE_TIMEOUT_MS
 * and failure-isolated: one dead store never blanks the page.
 */
export const PROBE_TIMEOUT_MS = 2500;

export async function withTimeout<T>(p: Promise<T>, ms = PROBE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface PostgresReport {
  ok: boolean;
  error?: string;
  version?: string;
  databaseSizeBytes?: number;
  connections?: number;
}

export async function probePostgres(url: string | undefined): Promise<PostgresReport | null> {
  if (!url) return null;
  const client = new PgClient({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS });
  try {
    await withTimeout(client.connect());
    const [version, size, conns] = await withTimeout(
      Promise.all([
        client.query('SELECT version()'),
        client.query('SELECT pg_database_size(current_database())::bigint AS size'),
        client.query('SELECT numbackends FROM pg_stat_database WHERE datname = current_database()'),
      ]),
    );
    return {
      ok: true,
      version: String(version.rows[0]?.version ?? '').split(' on ')[0],
      databaseSizeBytes: Number(size.rows[0]?.size ?? 0),
      connections: Number(conns.rows[0]?.numbackends ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'probe failed' };
  } finally {
    await client.end().catch(() => {});
  }
}

export interface ClickHouseReport {
  ok: boolean;
  error?: string;
  version?: string;
  diskUsedBytes?: number;
  diskTotalBytes?: number;
  topTables?: Array<{ table: string; bytes: number; rows: number }>;
}

export async function probeClickHouse(): Promise<ClickHouseReport | null> {
  const env = loadEnv();
  if (!env.CLICKHOUSE_URL) return null;
  const ch = createClickHouse({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD ?? '',
    request_timeout: PROBE_TIMEOUT_MS,
  });
  try {
    const q = async <T,>(query: string): Promise<T[]> => {
      const rs = await ch.query({ query, format: 'JSONEachRow' });
      return (await rs.json()) as T[];
    };
    const [ver, disks, tables] = await withTimeout(
      Promise.all([
        q<{ v: string }>('SELECT version() AS v'),
        q<{ used: string; total: string }>(
          'SELECT sum(total_space - free_space) AS used, sum(total_space) AS total FROM system.disks',
        ),
        q<{ table: string; bytes: string; rows: string }>(
          "SELECT table, sum(bytes_on_disk) AS bytes, sum(rows) AS rows FROM system.parts WHERE active GROUP BY table ORDER BY bytes DESC LIMIT 8",
        ),
      ]),
    );
    return {
      ok: true,
      version: ver[0]?.v,
      diskUsedBytes: Number(disks[0]?.used ?? 0),
      diskTotalBytes: Number(disks[0]?.total ?? 0),
      topTables: tables.map((t) => ({ table: t.table, bytes: Number(t.bytes), rows: Number(t.rows) })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'probe failed' };
  } finally {
    await ch.close().catch(() => {});
  }
}

export interface RedisReport {
  ok: boolean;
  error?: string;
  usedMemoryBytes?: number;
  maxMemoryBytes?: number;
  keys?: number;
  version?: string;
}

export async function probeRedis(): Promise<RedisReport | null> {
  const env = loadEnv();
  if (!env.REDIS_URL) return null;
  const redis = new Redis(env.REDIS_URL, {
    connectTimeout: PROBE_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await withTimeout(redis.connect());
    const [info, dbsize, server] = await withTimeout(
      Promise.all([redis.info('memory'), redis.dbsize(), redis.info('server')]),
    );
    const grab = (blob: string, key: string): string | undefined =>
      blob.split('\r\n').find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1);
    return {
      ok: true,
      usedMemoryBytes: Number(grab(info, 'used_memory') ?? 0),
      maxMemoryBytes: Number(grab(info, 'maxmemory') ?? 0),
      keys: dbsize,
      version: grab(server, 'redis_version'),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'probe failed' };
  } finally {
    redis.disconnect();
  }
}

export interface ServiceHealth {
  name: string;
  ok: boolean;
  status?: number;
  checks?: Record<string, boolean>;
  error?: string;
  /** Wall-clock duration of the readiness probe — charted as svc.latency.ms/<name>. */
  durationMs?: number;
}

export async function probeService(name: string, baseUrl: string | undefined): Promise<ServiceHealth | null> {
  if (!baseUrl) return null;
  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS + 1500),
    });
    const body = (await res.json().catch(() => ({}))) as { checks?: Record<string, boolean> };
    return { name, ok: res.ok, status: res.status, checks: body.checks, durationMs: Date.now() - startedAt };
  } catch (e) {
    return { name, ok: false, error: e instanceof Error ? e.message : 'unreachable', durationMs: Date.now() - startedAt };
  }
}
