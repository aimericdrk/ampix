import { Client } from 'undici';
import { kubeAvailable, kubeGet, kubeGetText } from './kube';
import { loadEnv } from './env';

/**
 * Log browsing (ops console): Kubernetes pod logs in the release namespace + host Docker container
 * logs over the read-only socket. Pure parsing helpers are unit-tested; sources are validated
 * against live listings — a client can never name an arbitrary pod/container path.
 */

export const MAX_TAIL = 2000;

export function clampTail(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 500;
  return Math.min(MAX_TAIL, Math.floor(n));
}

export interface LogLine {
  ts: string | null; // RFC3339 timestamp when available
  text: string;
}

/** k8s `timestamps=true` prefixes each line with RFC3339Nano + space. */
export function parseK8sLogLines(raw: string): LogLine[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => {
      const sp = l.indexOf(' ');
      const maybeTs = sp > 0 ? l.slice(0, sp) : '';
      if (/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z?$/.test(maybeTs)) {
        return { ts: maybeTs, text: l.slice(sp + 1) };
      }
      return { ts: null, text: l };
    });
}

/**
 * Docker multiplexed log stream: frames of [stream(1) 0 0 0 len(4,BE)] + payload (no TTY).
 * Falls back to treating the buffer as plain text when it doesn't look framed (TTY containers).
 */
export function demuxDockerLogs(buf: Buffer): string {
  if (buf.length === 0) return '';
  const first = buf[0]!;
  const looksFramed = (first === 0 || first === 1 || first === 2) && buf.length >= 8 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksFramed) return buf.toString('utf8');
  const parts: Buffer[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off + 4);
    parts.push(buf.subarray(off + 8, Math.min(off + 8 + len, buf.length)));
    off += 8 + len;
  }
  return Buffer.concat(parts).toString('utf8');
}

/** Docker log lines carry RFC3339Nano timestamps when requested with timestamps=1. */
export function parseDockerLogLines(raw: string): LogLine[] {
  return parseK8sLogLines(raw); // same "<ts> <text>" shape
}

export interface LogSources {
  kubernetes: Array<{
    deployment: string | null;
    pod: string;
    containers: string[];
    phase: string;
    restarts: number;
  }>;
  docker: Array<{ id: string; name: string; state: string }>;
}

interface PodListRaw {
  items: Array<{
    metadata: { name: string; labels?: Record<string, string> };
    spec?: { containers?: Array<{ name: string }> };
    status?: { phase?: string; containerStatuses?: Array<{ restartCount: number }> };
  }>;
}

export async function listLogSources(): Promise<LogSources> {
  const env = loadEnv();
  const out: LogSources = { kubernetes: [], docker: [] };
  if (kubeAvailable()) {
    try {
      const pods = await kubeGet<PodListRaw>(`/api/v1/namespaces/${env.POD_NAMESPACE}/pods`);
      out.kubernetes = pods.items.map((p) => ({
        // app.kubernetes.io/name is set by our chart; fall back to the pod-template prefix.
        deployment: p.metadata.labels?.['app.kubernetes.io/name'] ?? null,
        pod: p.metadata.name,
        containers: p.spec?.containers?.map((c) => c.name) ?? [],
        phase: p.status?.phase ?? 'Unknown',
        restarts: p.status?.containerStatuses?.reduce((a, c) => a + c.restartCount, 0) ?? 0,
      }));
    } catch {
      // cluster unreachable — kubernetes sources stay empty
    }
  }
  if (env.DOCKER_SOCK) {
    const client = new Client('http://localhost', { socketPath: env.DOCKER_SOCK });
    try {
      const res = await client.request({ method: 'GET', path: '/v1.44/containers/json?all=1', headersTimeout: 3000, bodyTimeout: 3000 });
      if (res.statusCode < 300) {
        const raw = (await res.body.json()) as Array<{ Id: string; Names: string[]; State: string }>;
        out.docker = raw.map((c) => ({ id: c.Id.slice(0, 12), name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12), state: c.State }));
      }
    } catch {
      // socket unavailable — docker sources stay empty
    } finally {
      await client.close().catch(() => {});
    }
  }
  return out;
}

export class LogAccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchK8sLogs(opts: {
  pod: string;
  container?: string;
  tail: number;
  sinceSeconds?: number;
  previous?: boolean;
}): Promise<LogLine[]> {
  const env = loadEnv();
  const sources = await listLogSources();
  const entry = sources.kubernetes.find((k) => k.pod === opts.pod);
  if (!entry) throw new LogAccessError(404, `no pod "${opts.pod}" in namespace ${env.POD_NAMESPACE}`);
  const container = opts.container && entry.containers.includes(opts.container) ? opts.container : entry.containers[0];
  const params = new URLSearchParams({ timestamps: 'true', tailLines: String(opts.tail) });
  if (container) params.set('container', container);
  if (opts.sinceSeconds) params.set('sinceSeconds', String(opts.sinceSeconds));
  if (opts.previous) params.set('previous', 'true');
  const raw = await kubeGetText(`/api/v1/namespaces/${env.POD_NAMESPACE}/pods/${opts.pod}/log?${params}`);
  return parseK8sLogLines(raw);
}

export async function fetchDockerLogs(opts: { id: string; tail: number; sinceSeconds?: number }): Promise<LogLine[]> {
  const env = loadEnv();
  if (!env.DOCKER_SOCK) throw new LogAccessError(400, 'docker socket not configured');
  const sources = await listLogSources();
  const entry = sources.docker.find((d) => d.id === opts.id || d.name === opts.id);
  if (!entry) throw new LogAccessError(404, `no container "${opts.id}"`);
  const params = new URLSearchParams({ stdout: '1', stderr: '1', timestamps: '1', tail: String(opts.tail) });
  if (opts.sinceSeconds) params.set('since', String(Math.floor(Date.now() / 1000) - opts.sinceSeconds));
  const client = new Client('http://localhost', { socketPath: env.DOCKER_SOCK });
  try {
    const res = await client.request({
      method: 'GET',
      path: `/v1.44/containers/${entry.id}/logs?${params}`,
      headersTimeout: 5000,
      bodyTimeout: 8000,
    });
    if (res.statusCode >= 300) throw new LogAccessError(res.statusCode, `docker logs → HTTP ${res.statusCode}`);
    const buf = Buffer.from(await res.body.arrayBuffer());
    return parseDockerLogLines(demuxDockerLogs(buf));
  } finally {
    await client.close().catch(() => {});
  }
}
