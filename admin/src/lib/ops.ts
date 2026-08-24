import { kubeGet, kubePatch } from './kube';
import { loadEnv } from './env';

/**
 * Operational actions (v2 design Phase 2): restart + scale, restricted to the release namespace.
 * Pure helpers build/validate everything; the routes only glue auth + audit around them.
 */

export const SCALE_MIN = 0;
export const SCALE_MAX = 10;

export class OpsError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The rollout-restart patch `kubectl rollout restart` applies. `at` injectable for tests. */
export function restartPatchBody(at: string): unknown {
  return {
    spec: {
      template: {
        metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': at } },
      },
    },
  };
}

export function validateReplicas(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < SCALE_MIN || n > SCALE_MAX) {
    throw new OpsError(400, `replicas must be an integer between ${SCALE_MIN} and ${SCALE_MAX}`);
  }
  return n;
}

interface DeploymentListLite {
  items: Array<{ metadata: { name: string } }>;
}
interface HpaListLite {
  items: Array<{ spec: { scaleTargetRef: { kind: string; name: string } } }>;
}

/** The deployment must exist in OUR namespace (allowlist by live lookup, never by client input). */
export async function assertDeploymentInNamespace(name: string): Promise<string> {
  const ns = loadEnv().POD_NAMESPACE;
  const list = await kubeGet<DeploymentListLite>(`/apis/apps/v1/namespaces/${ns}/deployments`);
  if (!list.items.some((d) => d.metadata.name === name)) {
    throw new OpsError(404, `no deployment "${name}" in namespace ${ns}`);
  }
  return ns;
}

export async function assertNotHpaManaged(ns: string, name: string): Promise<void> {
  const hpas = await kubeGet<HpaListLite>(`/apis/autoscaling/v2/namespaces/${ns}/horizontalpodautoscalers`);
  if (hpas.items.some((h) => h.spec.scaleTargetRef.kind === 'Deployment' && h.spec.scaleTargetRef.name === name)) {
    throw new OpsError(409, `"${name}" is HPA-managed — adjust the autoscaler bounds in the chart values instead of scaling by hand`);
  }
}

export async function restartDeployment(name: string, now = new Date()): Promise<void> {
  const ns = await assertDeploymentInNamespace(name);
  await kubePatch(`/apis/apps/v1/namespaces/${ns}/deployments/${name}`, restartPatchBody(now.toISOString()));
}

export async function scaleDeployment(name: string, replicas: number): Promise<void> {
  const n = validateReplicas(replicas);
  const ns = await assertDeploymentInNamespace(name);
  await assertNotHpaManaged(ns, name);
  await kubePatch(
    `/apis/apps/v1/namespaces/${ns}/deployments/${name}/scale`,
    { spec: { replicas: n } },
    'application/merge-patch+json',
  );
}
