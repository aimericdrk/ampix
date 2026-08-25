import type { Prisma, PrismaClient } from '../../generated/client';
import { prisma } from './db';
import { loadEnv } from './env';
import { kubeAvailable, kubeGet, mapCertificates, mapDeployments, mapNodes, mapPods } from './kube';
import { probeClickHouse, probePostgres, probeRedis, probeService } from './datastores';
import { dockerRunningCount } from './docker';
import { backupReport } from './backups';
import { evaluateRules } from './rules';

/**
 * Metric sampler + alert engine (v2 design Phase 3). One tick: collect → snapshot → prune →
 * evaluate → open/resolve AlertEvents → optional webhook. Streaks are in-memory (a restart just
 * re-requires 2 breaching ticks); DB writes are single-flighted across replicas via a Postgres
 * transaction-scoped advisory lock.
 */
export const SNAPSHOT_RETENTION_DAYS = 7;
const ADVISORY_LOCK_ID = 728_100_42;

let streaks: Record<string, number> = {};

export async function collectSamples(): Promise<Record<string, number>> {
  const env = loadEnv();
  const samples: Record<string, number> = {};

  if (kubeAvailable()) {
    try {
      const [nodes, metrics] = await Promise.all([
        kubeGet<Parameters<typeof mapNodes>[0]>('/api/v1/nodes'),
        kubeGet<NonNullable<Parameters<typeof mapNodes>[1]>>(
          '/apis/metrics.k8s.io/v1beta1/nodes',
        ).catch(() => null),
      ]);
      const summaries: Record<string, Parameters<typeof mapNodes>[2][string]> = {};
      await Promise.all(
        nodes.items.map(async (n) => {
          summaries[n.metadata.name] = await kubeGet<
            NonNullable<Parameters<typeof mapNodes>[2][string]>
          >(`/api/v1/nodes/${n.metadata.name}/proxy/stats/summary`).catch(() => null);
        }),
      );
      for (const v of mapNodes(nodes, metrics, summaries)) {
        if (v.cpuUsedCores !== null && v.cpuCapacityCores > 0)
          samples[`node.cpu.pct/${v.name}`] = (v.cpuUsedCores / v.cpuCapacityCores) * 100;
        if (v.memUsedBytes !== null && v.memCapacityBytes > 0)
          samples[`node.mem.pct/${v.name}`] = (v.memUsedBytes / v.memCapacityBytes) * 100;
        if (v.fsUsedBytes !== null && v.fsCapacityBytes)
          samples[`node.fs.pct/${v.name}`] = (v.fsUsedBytes / v.fsCapacityBytes) * 100;
        // Absolute counterparts for the metrics charts (v3): cores and bytes, not just percent.
        if (v.cpuUsedCores !== null) samples[`node.cpu.cores/${v.name}`] = v.cpuUsedCores;
        if (v.memUsedBytes !== null) samples[`node.mem.bytes/${v.name}`] = v.memUsedBytes;
        if (v.fsUsedBytes !== null) samples[`node.fs.bytes/${v.name}`] = v.fsUsedBytes;
      }
      const deps = mapDeployments(
        await kubeGet<Parameters<typeof mapDeployments>[0]>(
          `/apis/apps/v1/namespaces/${env.POD_NAMESPACE}/deployments`,
        ),
      );
      for (const d of deps) {
        if (d.desired > 0) samples[`deploy.ready.pct/${d.name}`] = (d.ready / d.desired) * 100;
        samples[`deploy.replicas/${d.name}`] = d.ready;
      }
      // Pod-level rollups for the app namespace: instance counts + restart totals.
      const podList = mapPods(
        await kubeGet<Parameters<typeof mapPods>[0]>(
          `/api/v1/namespaces/${env.POD_NAMESPACE}/pods`,
        ),
        null,
      );
      samples['k8s.pods.running'] = podList.filter((p) => p.phase === 'Running').length;
      samples['k8s.pods.total'] = podList.length;
      samples['k8s.restarts.total'] = podList.reduce((acc, p) => acc + p.restarts, 0);
      try {
        const hpas = await kubeGet<{
          items: Array<{ metadata: { name: string }; status?: { currentReplicas?: number } }>;
        }>(`/apis/autoscaling/v2/namespaces/${env.POD_NAMESPACE}/horizontalpodautoscalers`);
        for (const h of hpas.items)
          samples[`hpa.replicas/${h.metadata.name}`] = h.status?.currentReplicas ?? 0;
      } catch {
        // HPA API unavailable — skip
      }
      const certs = mapCertificates(
        await kubeGet<Parameters<typeof mapCertificates>[0]>(
          '/apis/cert-manager.io/v1/certificates',
        ).catch(() => ({ items: [] })),
      );
      for (const c of certs) {
        if (c.notAfter)
          samples[`cert.days/${c.name}`] =
            (new Date(c.notAfter).getTime() - Date.now()) / 86_400_000;
      }
    } catch {
      // cluster unreachable this tick — keep whatever else we can sample
    }
  }

  const [adminPg, analyticsPg, purchasePg, ch, redis, svcA, svcP] = await Promise.all([
    probePostgres(env.DATABASE_URL),
    probePostgres(env.ANALYTICS_DATABASE_URL),
    probePostgres(env.PURCHASE_DATABASE_URL),
    probeClickHouse(),
    probeRedis(),
    probeService('mobile-analytics', env.ANALYTICS_INTERNAL_URL),
    probeService('mobile-purchase', env.PURCHASE_INTERNAL_URL),
  ]);
  const up = (name: string, ok: boolean | undefined | null): void => {
    samples[name] = ok ? 1 : 0;
  };
  if (adminPg) up('ds.up/admin-postgres', adminPg.ok);
  if (analyticsPg) up('ds.up/postgres', analyticsPg.ok);
  if (purchasePg) up('ds.up/mobile-purchase-postgres', purchasePg.ok);
  if (ch) up('ds.up/clickhouse', ch.ok);
  if (redis) up('ds.up/redis', redis.ok);
  if (svcA) up('svc.up/mobile-analytics', svcA.ok);
  if (svcP) up('svc.up/mobile-purchase', svcP.ok);
  // v3 chart series: sizes, connections, memory, latency, container count.
  for (const [name, pg] of [
    ['admin_console', adminPg],
    ['myampix', analyticsPg],
    ['mobile_purchase', purchasePg],
  ] as const) {
    if (pg?.ok) {
      if (pg.databaseSizeBytes !== undefined)
        samples[`ds.pg.size.bytes/${name}`] = pg.databaseSizeBytes;
      if (pg.connections !== undefined) samples[`ds.pg.conn/${name}`] = pg.connections;
    }
  }
  if (ch?.ok && ch.diskUsedBytes !== undefined) samples['ds.ch.disk.bytes'] = ch.diskUsedBytes;
  if (redis?.ok) {
    if (redis.usedMemoryBytes !== undefined) samples['ds.redis.mem.bytes'] = redis.usedMemoryBytes;
    if (redis.keys !== undefined) samples['ds.redis.keys'] = redis.keys;
  }
  if (svcA?.durationMs !== undefined) samples['svc.latency.ms/mobile-analytics'] = svcA.durationMs;
  if (svcP?.durationMs !== undefined) samples['svc.latency.ms/mobile-purchase'] = svcP.durationMs;
  const dockerN = await dockerRunningCount();
  if (dockerN !== null) samples['docker.containers.running'] = dockerN;

  // Backups (Backups page + backup.* rules). Only emitted when the directory is actually mounted —
  // an unmounted console must not raise "no backups" alerts about a host it cannot see.
  try {
    const backups = await backupReport();
    if (backups.available) {
      for (const d of backups.databases) {
        if (d.latestAgeHours !== null) samples[`backup.age.hours/${d.database}`] = d.latestAgeHours;
        samples[`backup.size.bytes/${d.database}`] = d.totalBytes;
      }
      samples['backup.total.bytes'] = backups.totalBytes;
      samples['backup.files'] = backups.files.length;
      samples['backup.databases.missing'] = backups.missingDatabases.length;
      if (backups.lastRun) samples['backup.last.ok'] = backups.lastRun.status === 'ok' ? 1 : 0;
    }
  } catch {
    // Backup visibility is never worth failing a whole sampling tick over.
  }
  return samples;
}

async function postWebhook(
  event: 'opened' | 'resolved',
  hit: { kind: string; key: string; message: string; value: number },
): Promise<void> {
  const url = loadEnv().ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event,
        ...hit,
        at: new Date().toISOString(),
        // `text` makes plain Slack/Discord-compatible webhooks render something readable.
        text: `[myampix-ops] ${event === 'opened' ? '🔴' : '🟢'} ${hit.message}`,
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.error('[sampler] webhook failed:', e instanceof Error ? e.message : e);
  }
}

/** One full tick. Exposed for the manual /api/admin/ops/sample trigger and the interval loop. */
export async function sampleTick(
  db: PrismaClient = prisma,
): Promise<{ wrote: boolean; sampleCount: number }> {
  const samples = await collectSamples();
  const openAlerts = await db.alertEvent.findMany({ where: { resolvedAt: null } });
  const {
    open,
    resolve,
    streaks: next,
  } = evaluateRules(samples, streaks, new Set(openAlerts.map((a) => a.key)));
  streaks = next;

  let wrote = false;
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const [{ locked }] = await tx.$queryRaw<
      [{ locked: boolean }]
    >`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) AS locked`;
    if (!locked) return; // another replica is writing this tick
    wrote = true;
    if (Object.keys(samples).length > 0) {
      await tx.metricSnapshot.createMany({
        data: Object.entries(samples).map(([key, value]) => ({ key, value })),
      });
    }
    await tx.metricSnapshot.deleteMany({
      where: { at: { lt: new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000) } },
    });
    for (const hit of open) {
      await tx.alertEvent.create({
        data: { kind: hit.kind, key: hit.key, message: hit.message, lastValue: hit.value },
      });
    }
    if (resolve.length > 0) {
      await tx.alertEvent.updateMany({
        where: { key: { in: resolve }, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }
  });

  if (wrote) {
    for (const hit of open) await postWebhook('opened', hit);
    for (const key of resolve) {
      const a = openAlerts.find((x) => x.key === key);
      if (a)
        await postWebhook('resolved', {
          kind: a.kind,
          key: a.key,
          message: a.message,
          value: samples[key] ?? 0,
        });
    }
  }
  return { wrote, sampleCount: Object.keys(samples).length };
}

let started = false;

export function startSampler(): void {
  if (started) return;
  started = true;
  const minutes = loadEnv().SAMPLE_INTERVAL_MINUTES;
  console.log(`[sampler] starting — every ${minutes} min`);
  const run = (): void => {
    void sampleTick().catch((e) =>
      console.error('[sampler] tick failed:', e instanceof Error ? e.message : e),
    );
  };
  setTimeout(run, 15_000); // first tick shortly after boot
  setInterval(run, minutes * 60_000).unref();
}
