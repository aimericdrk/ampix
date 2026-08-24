import { describe, expect, it } from 'vitest';
import { evaluateRules } from './rules';

const none = new Set<string>();

describe('evaluateRules', () => {
  it('opens only after 2 consecutive breaching ticks (flap guard)', () => {
    const t1 = evaluateRules({ 'node.cpu.pct/vps': 95 }, {}, none);
    expect(t1.open).toHaveLength(0);
    expect(t1.streaks['node.cpu.pct/vps']).toBe(1);
    const t2 = evaluateRules({ 'node.cpu.pct/vps': 96 }, t1.streaks, none);
    expect(t2.open).toHaveLength(1);
    expect(t2.open[0]).toMatchObject({ kind: 'node.cpu', key: 'node.cpu.pct/vps' });
  });
  it('does not reopen an already-open alert; resolves on the first clear tick', () => {
    const openSet = new Set(['node.cpu.pct/vps']);
    const still = evaluateRules({ 'node.cpu.pct/vps': 97 }, { 'node.cpu.pct/vps': 5 }, openSet);
    expect(still.open).toHaveLength(0);
    expect(still.resolve).toHaveLength(0);
    const clear = evaluateRules({ 'node.cpu.pct/vps': 40 }, { 'node.cpu.pct/vps': 6 }, openSet);
    expect(clear.resolve).toEqual(['node.cpu.pct/vps']);
    expect(clear.streaks['node.cpu.pct/vps']).toBe(0);
  });
  it('a missing sample keeps the streak (collection gap ≠ recovery)', () => {
    const r = evaluateRules({}, { 'ds.up/redis': 1 }, none);
    expect(r.streaks['ds.up/redis']).toBe(1);
    expect(r.resolve).toHaveLength(0);
  });
  it('covers the fixed rule set', () => {
    const r = evaluateRules(
      {
        'node.mem.pct/vps': 95,
        'node.fs.pct/vps': 90,
        'ds.up/redis': 0,
        'svc.up/mobile-analytics': 0,
        'deploy.ready.pct/dashboard': 50,
        'cert.days/api-example-com-tls': 3,
      },
      {
        'node.mem.pct/vps': 1,
        'node.fs.pct/vps': 1,
        'ds.up/redis': 1,
        'svc.up/mobile-analytics': 1,
        'deploy.ready.pct/dashboard': 1,
        'cert.days/api-example-com-tls': 1,
      },
      none,
    );
    expect(r.open.map((o) => o.kind).sort()).toEqual([
      'cert.expiry', 'deploy.degraded', 'ds.down', 'node.fs', 'node.mem', 'svc.down',
    ]);
  });
});
