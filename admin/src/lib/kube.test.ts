import { describe, expect, it } from 'vitest';
import {
  mapCertificates,
  mapDeployments,
  mapHpas,
  mapJobs,
  mapNodes,
  mapPods,
  mapWarningEvents,
  parseCpu,
  parseMem,
} from './kube';

describe('quantity parsing', () => {
  it('parses CPU quantities', () => {
    expect(parseCpu('250m')).toBeCloseTo(0.25);
    expect(parseCpu('2')).toBe(2);
    expect(parseCpu('1500000n')).toBeCloseTo(0.0015);
  });
  it('parses memory quantities', () => {
    expect(parseMem('512Mi')).toBe(512 * 1024 * 1024);
    expect(parseMem('1Gi')).toBe(1024 ** 3);
    expect(parseMem('128974848')).toBe(128974848);
    expect(parseMem('garbage!')).toBe(0);
  });
});

describe('mappers', () => {
  it('maps nodes with metrics and stats summary', () => {
    const nodes = {
      items: [
        {
          metadata: { name: 'vps' },
          status: {
            conditions: [{ type: 'Ready', status: 'True' }],
            nodeInfo: { kubeletVersion: 'v1.33.1+k3s1', osImage: 'Ubuntu 24.04' },
            capacity: { cpu: '4', memory: '8Gi' },
          },
        },
      ],
    };
    const metrics = { items: [{ metadata: { name: 'vps' }, usage: { cpu: '500m', memory: '2Gi' } }] };
    const summaries = {
      vps: { node: { fs: { usedBytes: 10, capacityBytes: 100 }, startTime: '2026-08-01T00:00:00Z' } },
    };
    const [v] = mapNodes(nodes, metrics, summaries);
    expect(v).toMatchObject({
      name: 'vps',
      ready: true,
      cpuCapacityCores: 4,
      cpuUsedCores: 0.5,
      memUsedBytes: 2 * 1024 ** 3,
      fsUsedBytes: 10,
      bootedAt: '2026-08-01T00:00:00Z',
    });
  });

  it('maps nodes without metrics (metrics-server down) to nulls, not crashes', () => {
    const [v] = mapNodes(
      { items: [{ metadata: { name: 'vps' }, status: {} }] },
      null,
      { vps: null },
    );
    expect(v.cpuUsedCores).toBeNull();
    expect(v.ready).toBe(false);
  });

  it('maps pods with summed container usage and restarts', () => {
    const pods = {
      items: [
        {
          metadata: { name: 'p1', namespace: 'myampix' },
          spec: { nodeName: 'vps' },
          status: {
            phase: 'Running',
            startTime: '2026-08-24T00:00:00Z',
            containerStatuses: [
              { ready: true, restartCount: 2 },
              { ready: false, restartCount: 1 },
            ],
          },
        },
      ],
    };
    const metrics = {
      items: [
        {
          metadata: { name: 'p1', namespace: 'myampix' },
          containers: [{ usage: { cpu: '100m', memory: '64Mi' } }, { usage: { cpu: '50m', memory: '32Mi' } }],
        },
      ],
    };
    const [v] = mapPods(pods, metrics);
    expect(v).toMatchObject({ ready: '1/2', restarts: 3, node: 'vps' });
    expect(v.cpuUsedCores).toBeCloseTo(0.15);
    expect(v.memUsedBytes).toBe(96 * 1024 * 1024);
  });

  it('maps deployments, HPAs, jobs, warning events, certificates', () => {
    expect(
      mapDeployments({
        items: [
          {
            metadata: { name: 'd', namespace: 'ns' },
            spec: { replicas: 3, template: { spec: { containers: [{ image: 'img:1' }] } } },
            status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
          },
        ],
      })[0],
    ).toMatchObject({ ready: 2, desired: 3, image: 'img:1' });

    expect(
      mapHpas({
        items: [
          {
            metadata: { name: 'h', namespace: 'ns' },
            spec: {
              scaleTargetRef: { kind: 'Deployment', name: 'd' },
              maxReplicas: 6,
              minReplicas: 2,
              metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { averageUtilization: 70 } } }],
            },
            status: {
              currentReplicas: 2,
              desiredReplicas: 2,
              currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 41 } } }],
            },
          },
        ],
      })[0],
    ).toMatchObject({ target: 'Deployment/d', cpuCurrentPercent: 41, cpuTargetPercent: 70 });

    expect(
      mapJobs({ items: [{ metadata: { name: 'j', namespace: 'ns' }, status: { succeeded: 1 } }] })[0],
    ).toMatchObject({ succeeded: true, failed: false });

    const events = mapWarningEvents({
      items: [
        { type: 'Normal', reason: 'Pulled', message: 'ok' },
        {
          type: 'Warning',
          reason: 'BackOff',
          lastTimestamp: '2026-08-24T10:00:00Z',
          involvedObject: { kind: 'Pod', name: 'p' },
          message: 'crash',
          count: 4,
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'BackOff', object: 'Pod/p', count: 4 });

    expect(
      mapCertificates({
        items: [
          {
            metadata: { name: 'c', namespace: 'ns' },
            spec: { dnsNames: ['api.x.com'] },
            status: { conditions: [{ type: 'Ready', status: 'True' }], notAfter: '2026-11-01T00:00:00Z' },
          },
        ],
      })[0],
    ).toMatchObject({ ready: true, notAfter: '2026-11-01T00:00:00Z' });
  });
});
