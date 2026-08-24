import { readFileSync } from 'node:fs';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Minimal in-cluster Kubernetes REST client (design §4). Reads the mounted ServiceAccount token +
 * CA, targets the API server from the standard env vars. The token is re-read when older than a
 * minute (BoundServiceAccountToken rotation). No client library — typed mappers below shape the
 * few resources the console shows.
 */
const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

interface TokenCache {
  token: string;
  readAt: number;
}
let tokenCache: TokenCache | undefined;
let agent: Agent | undefined;

export function kubeAvailable(): boolean {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

function saToken(): string {
  const now = Date.now();
  if (!tokenCache || now - tokenCache.readAt > 60_000) {
    tokenCache = { token: readFileSync(`${SA_DIR}/token`, 'utf8').trim(), readAt: now };
  }
  return tokenCache.token;
}

function kubeAgent(): Agent {
  agent ??= new Agent({ connect: { ca: readFileSync(`${SA_DIR}/ca.crt`) } });
  return agent;
}

export class KubeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function kubeRequest<T>(
  method: 'GET' | 'PATCH',
  path: string,
  body?: unknown,
  contentType = 'application/strategic-merge-patch+json',
): Promise<T> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? '443';
  if (!host) throw new KubeError(0, 'not running in a cluster');
  const res = await undiciFetch(`https://${host}:${port}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${saToken()}`,
      ...(body !== undefined ? { 'content-type': contentType } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    dispatcher: kubeAgent(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new KubeError(res.status, `${method} ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Strategic-merge PATCH (ops actions — v2 design Phase 2). */
export async function kubePatch<T>(path: string, body: unknown, contentType?: string): Promise<T> {
  return kubeRequest<T>('PATCH', path, body, contentType);
}

export async function kubeGet<T>(path: string): Promise<T> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? '443';
  if (!host) throw new KubeError(0, 'not running in a cluster');
  const res = await undiciFetch(`https://${host}:${port}${path}`, {
    headers: { authorization: `Bearer ${saToken()}` },
    dispatcher: kubeAgent(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new KubeError(res.status, `${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ---------- quantity parsing ----------

/** Parses a Kubernetes CPU quantity ("250m", "2", "1500000n") into cores. */
export function parseCpu(q: string): number {
  if (q.endsWith('n')) return Number(q.slice(0, -1)) / 1e9;
  if (q.endsWith('u')) return Number(q.slice(0, -1)) / 1e6;
  if (q.endsWith('m')) return Number(q.slice(0, -1)) / 1e3;
  return Number(q);
}

const MEM_FACTORS: Record<string, number> = {
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4,
  K: 1e3, M: 1e6, G: 1e9, T: 1e12, k: 1e3,
};

/** Parses a Kubernetes memory quantity ("512Mi", "1Gi", "128974848") into bytes. */
export function parseMem(q: string): number {
  const m = q.match(/^([0-9.]+)([A-Za-z]*)$/);
  if (!m) return 0;
  const [, num, suffix] = m;
  return Number(num) * (suffix ? (MEM_FACTORS[suffix] ?? 0) : 1);
}

// ---------- typed views + mappers (unit-tested on fixture JSON) ----------

export interface NodeView {
  name: string;
  ready: boolean;
  kubeletVersion: string;
  osImage: string;
  cpuCapacityCores: number;
  memCapacityBytes: number;
  cpuUsedCores: number | null;
  memUsedBytes: number | null;
  fsUsedBytes: number | null;
  fsCapacityBytes: number | null;
  bootedAt: string | null;
}

interface K8sNodeList {
  items: Array<{
    metadata: { name: string };
    status: {
      conditions?: Array<{ type: string; status: string }>;
      nodeInfo?: { kubeletVersion?: string; osImage?: string; bootID?: string };
      allocatable?: Record<string, string>;
      capacity?: Record<string, string>;
    };
  }>;
}
interface NodeMetricsList {
  items: Array<{ metadata: { name: string }; usage: { cpu: string; memory: string } }>;
}
interface StatsSummary {
  node?: { fs?: { usedBytes?: number; capacityBytes?: number }; startTime?: string };
}

export function mapNodes(
  nodes: K8sNodeList,
  metrics: NodeMetricsList | null,
  summaries: Record<string, StatsSummary | null>,
): NodeView[] {
  return nodes.items.map((n) => {
    const usage = metrics?.items.find((m) => m.metadata.name === n.metadata.name)?.usage;
    const summary = summaries[n.metadata.name];
    return {
      name: n.metadata.name,
      ready: n.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false,
      kubeletVersion: n.status.nodeInfo?.kubeletVersion ?? '?',
      osImage: n.status.nodeInfo?.osImage ?? '?',
      cpuCapacityCores: parseCpu(n.status.capacity?.cpu ?? '0'),
      memCapacityBytes: parseMem(n.status.capacity?.memory ?? '0'),
      cpuUsedCores: usage ? parseCpu(usage.cpu) : null,
      memUsedBytes: usage ? parseMem(usage.memory) : null,
      fsUsedBytes: summary?.node?.fs?.usedBytes ?? null,
      fsCapacityBytes: summary?.node?.fs?.capacityBytes ?? null,
      bootedAt: summary?.node?.startTime ?? null,
    };
  });
}

export interface PodView {
  name: string;
  namespace: string;
  phase: string;
  ready: string; // "1/1"
  restarts: number;
  startedAt: string | null;
  cpuUsedCores: number | null;
  memUsedBytes: number | null;
  node: string | null;
}

interface K8sPodList {
  items: Array<{
    metadata: { name: string; namespace: string };
    spec?: { nodeName?: string };
    status: {
      phase?: string;
      startTime?: string;
      containerStatuses?: Array<{ ready: boolean; restartCount: number }>;
    };
  }>;
}
interface PodMetricsList {
  items: Array<{
    metadata: { name: string; namespace: string };
    containers: Array<{ usage: { cpu: string; memory: string } }>;
  }>;
}

export function mapPods(pods: K8sPodList, metrics: PodMetricsList | null): PodView[] {
  return pods.items.map((p) => {
    const cs = p.status.containerStatuses ?? [];
    const usage = metrics?.items.find(
      (m) => m.metadata.name === p.metadata.name && m.metadata.namespace === p.metadata.namespace,
    );
    const cpu = usage?.containers.reduce((acc, c) => acc + parseCpu(c.usage.cpu), 0);
    const mem = usage?.containers.reduce((acc, c) => acc + parseMem(c.usage.memory), 0);
    return {
      name: p.metadata.name,
      namespace: p.metadata.namespace,
      phase: p.status.phase ?? 'Unknown',
      ready: `${cs.filter((c) => c.ready).length}/${cs.length}`,
      restarts: cs.reduce((acc, c) => acc + c.restartCount, 0),
      startedAt: p.status.startTime ?? null,
      cpuUsedCores: cpu ?? null,
      memUsedBytes: mem ?? null,
      node: p.spec?.nodeName ?? null,
    };
  });
}

export interface DeploymentView {
  name: string;
  namespace: string;
  ready: number;
  desired: number;
  updated: number;
  available: number;
  image: string | null;
}

interface K8sDeploymentList {
  items: Array<{
    metadata: { name: string; namespace: string };
    spec?: { replicas?: number; template?: { spec?: { containers?: Array<{ image?: string }> } } };
    status?: { readyReplicas?: number; updatedReplicas?: number; availableReplicas?: number };
  }>;
}

export function mapDeployments(list: K8sDeploymentList): DeploymentView[] {
  return list.items.map((d) => ({
    name: d.metadata.name,
    namespace: d.metadata.namespace,
    ready: d.status?.readyReplicas ?? 0,
    desired: d.spec?.replicas ?? 0,
    updated: d.status?.updatedReplicas ?? 0,
    available: d.status?.availableReplicas ?? 0,
    image: d.spec?.template?.spec?.containers?.[0]?.image ?? null,
  }));
}

export interface HpaView {
  name: string;
  namespace: string;
  target: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  desiredReplicas: number;
  cpuCurrentPercent: number | null;
  cpuTargetPercent: number | null;
}

interface K8sHpaList {
  items: Array<{
    metadata: { name: string; namespace: string };
    spec: {
      scaleTargetRef: { kind: string; name: string };
      minReplicas?: number;
      maxReplicas: number;
      metrics?: Array<{ type: string; resource?: { name: string; target?: { averageUtilization?: number } } }>;
    };
    status?: {
      currentReplicas?: number;
      desiredReplicas?: number;
      currentMetrics?: Array<{ type: string; resource?: { name: string; current?: { averageUtilization?: number } } }> | null;
    };
  }>;
}

export function mapHpas(list: K8sHpaList): HpaView[] {
  return list.items.map((h) => ({
    name: h.metadata.name,
    namespace: h.metadata.namespace,
    target: `${h.spec.scaleTargetRef.kind}/${h.spec.scaleTargetRef.name}`,
    minReplicas: h.spec.minReplicas ?? 1,
    maxReplicas: h.spec.maxReplicas,
    currentReplicas: h.status?.currentReplicas ?? 0,
    desiredReplicas: h.status?.desiredReplicas ?? 0,
    cpuCurrentPercent:
      h.status?.currentMetrics?.find((m) => m.resource?.name === 'cpu')?.resource?.current
        ?.averageUtilization ?? null,
    cpuTargetPercent:
      h.spec.metrics?.find((m) => m.resource?.name === 'cpu')?.resource?.target?.averageUtilization ??
      null,
  }));
}

export interface JobView {
  name: string;
  namespace: string;
  succeeded: boolean;
  failed: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

interface K8sJobList {
  items: Array<{
    metadata: { name: string; namespace: string };
    status?: { succeeded?: number; failed?: number; startTime?: string; completionTime?: string };
  }>;
}

export function mapJobs(list: K8sJobList): JobView[] {
  return list.items.map((j) => ({
    name: j.metadata.name,
    namespace: j.metadata.namespace,
    succeeded: (j.status?.succeeded ?? 0) > 0,
    failed: (j.status?.failed ?? 0) > 0,
    startedAt: j.status?.startTime ?? null,
    completedAt: j.status?.completionTime ?? null,
  }));
}

export interface EventView {
  at: string | null;
  type: string;
  reason: string;
  object: string;
  message: string;
  count: number;
}

interface K8sEventList {
  items: Array<{
    lastTimestamp?: string | null;
    eventTime?: string | null;
    type?: string;
    reason?: string;
    involvedObject?: { kind?: string; name?: string };
    message?: string;
    count?: number;
  }>;
}

export function mapWarningEvents(list: K8sEventList, limit = 30): EventView[] {
  return list.items
    .filter((e) => e.type === 'Warning')
    .map((e) => ({
      at: e.lastTimestamp ?? e.eventTime ?? null,
      type: e.type ?? '?',
      reason: e.reason ?? '?',
      object: `${e.involvedObject?.kind ?? '?'}/${e.involvedObject?.name ?? '?'}`,
      message: e.message ?? '',
      count: e.count ?? 1,
    }))
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, limit);
}

export interface CertificateView {
  name: string;
  namespace: string;
  ready: boolean;
  dnsNames: string[];
  notAfter: string | null;
}

interface CertManagerList {
  items: Array<{
    metadata: { name: string; namespace: string };
    spec?: { dnsNames?: string[] };
    status?: { conditions?: Array<{ type: string; status: string }>; notAfter?: string };
  }>;
}

export function mapCertificates(list: CertManagerList): CertificateView[] {
  return list.items.map((c) => ({
    name: c.metadata.name,
    namespace: c.metadata.namespace,
    ready: c.status?.conditions?.some((x) => x.type === 'Ready' && x.status === 'True') ?? false,
    dnsNames: c.spec?.dnsNames ?? [],
    notAfter: c.status?.notAfter ?? null,
  }));
}
