import { Client } from 'undici';
import { loadEnv } from './env';

/**
 * Host Docker visibility over the (read-only) unix socket (design §4). Uses undici's socketPath
 * support directly — no dockerode. Every call is bounded; a missing/broken socket degrades to
 * `{ available: false }` rather than erroring the page.
 */

export interface ContainerView {
  id: string;
  name: string;
  image: string;
  state: string; // running / exited / …
  status: string; // human string ("Up 3 days (healthy)")
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memLimitBytes: number | null;
}

export interface DockerReport {
  available: boolean;
  reason?: string;
  containers: ContainerView[];
}

interface RawContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

export interface RawStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
}

/** Docker's own CLI formula: delta of container cpu vs system cpu × online CPUs. */
export function cpuPercentFrom(stats: RawStats): number | null {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
  if (cpuDelta <= 0 || sysDelta <= 0) return 0;
  return (cpuDelta / sysDelta) * (stats.cpu_stats.online_cpus ?? 1) * 100;
}

/** Memory usage minus inactive page cache, like `docker stats`. */
export function memUsageFrom(stats: RawStats): { used: number | null; limit: number | null } {
  const usage = stats.memory_stats.usage;
  if (usage === undefined) return { used: null, limit: stats.memory_stats.limit ?? null };
  return {
    used: usage - (stats.memory_stats.stats?.inactive_file ?? 0),
    limit: stats.memory_stats.limit ?? null,
  };
}

async function dockerGet<T>(client: Client, path: string): Promise<T> {
  const res = await client.request({
    method: 'GET',
    path,
    headersTimeout: 3000,
    bodyTimeout: 3000,
  });
  if (res.statusCode >= 300) throw new Error(`docker ${path} → HTTP ${res.statusCode}`);
  return (await res.body.json()) as T;
}

export async function dockerReport(): Promise<DockerReport> {
  const sock = loadEnv().DOCKER_SOCK;
  if (!sock) return { available: false, reason: 'socket not configured', containers: [] };
  const client = new Client('http://localhost', { socketPath: sock });
  try {
    const raw = await dockerGet<RawContainer[]>(client, '/v1.44/containers/json?all=1');
    const containers = await Promise.all(
      raw.slice(0, 40).map(async (c): Promise<ContainerView> => {
        let cpuPercent: number | null = null;
        let mem: { used: number | null; limit: number | null } = { used: null, limit: null };
        if (c.State === 'running') {
          try {
            const stats = await dockerGet<RawStats>(
              client,
              `/v1.44/containers/${c.Id}/stats?stream=false&one-shot=false`,
            );
            cpuPercent = cpuPercentFrom(stats);
            mem = memUsageFrom(stats);
          } catch {
            // stats are best-effort per container
          }
        }
        return {
          id: c.Id.slice(0, 12),
          name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
          image: c.Image,
          state: c.State,
          status: c.Status,
          cpuPercent,
          memUsedBytes: mem.used,
          memLimitBytes: mem.limit,
        };
      }),
    );
    return { available: true, containers };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : 'socket error', containers: [] };
  } finally {
    await client.close().catch(() => {});
  }
}
