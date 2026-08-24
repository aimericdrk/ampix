import { describe, expect, it } from 'vitest';
import { OpsError, restartPatchBody, SCALE_MAX, validateReplicas } from './ops';

describe('ops helpers', () => {
  it('builds the kubectl rollout-restart patch shape', () => {
    expect(restartPatchBody('2026-08-24T12:00:00Z')).toEqual({
      spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': '2026-08-24T12:00:00Z' } } } },
    });
  });
  it('bounds replicas to integers within [0, 10]', () => {
    expect(validateReplicas(0)).toBe(0);
    expect(validateReplicas(SCALE_MAX)).toBe(SCALE_MAX);
    for (const bad of [-1, 11, 1.5, '2', null, undefined]) {
      expect(() => validateReplicas(bad)).toThrow(OpsError);
    }
  });
});
