import { describe, expect, it } from 'vitest';
import { cpuPercentFrom, memUsageFrom, type RawStats } from './docker';

function stats(over: Partial<RawStats> = {}): RawStats {
  return {
    cpu_stats: { cpu_usage: { total_usage: 400_000_000 }, system_cpu_usage: 10_000_000_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 200_000_000 }, system_cpu_usage: 8_000_000_000 },
    memory_stats: { usage: 100 * 1024 * 1024, limit: 512 * 1024 * 1024, stats: { inactive_file: 20 * 1024 * 1024 } },
    ...over,
  };
}

describe('docker stats math', () => {
  it('computes CPU% per the docker CLI formula', () => {
    // delta 0.2e9 over system delta 2e9 × 4 cpus × 100 = 40%
    expect(cpuPercentFrom(stats())).toBeCloseTo(40);
  });
  it('returns 0 for zero/negative deltas (first sample)', () => {
    expect(
      cpuPercentFrom(stats({ precpu_stats: { cpu_usage: { total_usage: 400_000_000 }, system_cpu_usage: 10_000_000_000 } })),
    ).toBe(0);
  });
  it('subtracts inactive page cache from memory like docker stats', () => {
    expect(memUsageFrom(stats())).toEqual({ used: 80 * 1024 * 1024, limit: 512 * 1024 * 1024 });
    expect(memUsageFrom(stats({ memory_stats: {} }))).toEqual({ used: null, limit: null });
  });
});
