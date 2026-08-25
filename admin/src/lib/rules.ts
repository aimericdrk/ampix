/**
 * Pure alert-rule evaluation (v2 design Phase 3). The sampler feeds one tick's samples plus the
 * previous breach streaks and currently-open alert keys; this returns what to open, what to
 * resolve, and the new streaks. Opening needs 2 consecutive breaching ticks (flap guard);
 * resolution happens on the first clear tick. Missing samples change nothing.
 */

export interface RuleHit {
  kind: string;
  key: string;
  message: string;
  value: number;
}

export interface EvalResult {
  open: RuleHit[];
  resolve: string[]; // alert keys to close
  streaks: Record<string, number>;
}

export const OPEN_AFTER_TICKS = 2;

interface Rule {
  kind: string;
  matches: (key: string) => boolean;
  breach: (value: number) => boolean;
  message: (key: string, value: number) => string;
}

const pct = (v: number): string => `${v.toFixed(0)}%`;

export const RULES: Rule[] = [
  {
    kind: 'node.cpu',
    matches: (k) => k.startsWith('node.cpu.pct/'),
    breach: (v) => v > 90,
    message: (k, v) => `Node ${k.split('/')[1]} CPU at ${pct(v)} (>90%)`,
  },
  {
    kind: 'node.mem',
    matches: (k) => k.startsWith('node.mem.pct/'),
    breach: (v) => v > 90,
    message: (k, v) => `Node ${k.split('/')[1]} memory at ${pct(v)} (>90%)`,
  },
  {
    kind: 'node.fs',
    matches: (k) => k.startsWith('node.fs.pct/'),
    breach: (v) => v > 85,
    message: (k, v) => `Node ${k.split('/')[1]} disk at ${pct(v)} (>85%)`,
  },
  {
    kind: 'ds.down',
    matches: (k) => k.startsWith('ds.up/'),
    breach: (v) => v < 1,
    message: (k) => `Datastore ${k.split('/')[1]} is down`,
  },
  {
    kind: 'svc.down',
    matches: (k) => k.startsWith('svc.up/'),
    breach: (v) => v < 1,
    message: (k) => `Service ${k.split('/')[1]} readiness is failing`,
  },
  {
    kind: 'deploy.degraded',
    matches: (k) => k.startsWith('deploy.ready.pct/'),
    breach: (v) => v < 100,
    message: (k, v) => `Deployment ${k.split('/')[1]} only ${pct(v)} ready`,
  },
  {
    kind: 'cert.expiry',
    matches: (k) => k.startsWith('cert.days/'),
    breach: (v) => v < 14,
    message: (k, v) => `Certificate ${k.split('/')[1]} expires in ${Math.floor(v)} days`,
  },
  {
    // Per-database age. 36h, not 24h: the timer has a 5-minute randomised delay and a run that
    // slips past midnight must not page anyone, but two missed nights must.
    kind: 'backup.stale',
    matches: (k) => k.startsWith('backup.age.hours/'),
    breach: (v) => v > 36,
    message: (k, v) => `Backup of ${k.split('/')[1]} is ${Math.floor(v)}h old (>36h)`,
  },
  {
    // Distinct from staleness: the last run errored even though older backups may still be fresh.
    kind: 'backup.failed',
    matches: (k) => k === 'backup.last.ok',
    breach: (v) => v < 1,
    message: () => 'Last backup run failed',
  },
  {
    kind: 'backup.missing',
    matches: (k) => k === 'backup.databases.missing',
    breach: (v) => v > 0,
    message: (_k, v) => `${Math.round(v)} database(s) have no backup at all`,
  },
];

export function evaluateRules(
  samples: Record<string, number>,
  prevStreaks: Record<string, number>,
  openKeys: ReadonlySet<string>,
): EvalResult {
  const streaks: Record<string, number> = {};
  const open: RuleHit[] = [];
  const resolve: string[] = [];
  for (const [key, value] of Object.entries(samples)) {
    const rule = RULES.find((r) => r.matches(key));
    if (!rule) continue;
    if (rule.breach(value)) {
      const streak = (prevStreaks[key] ?? 0) + 1;
      streaks[key] = streak;
      if (streak >= OPEN_AFTER_TICKS && !openKeys.has(key)) {
        open.push({ kind: rule.kind, key, message: rule.message(key, value), value });
      }
    } else {
      streaks[key] = 0;
      if (openKeys.has(key)) resolve.push(key);
    }
  }
  // Keys absent from this tick keep their previous streak (a collection gap is not a recovery).
  for (const [key, streak] of Object.entries(prevStreaks)) {
    if (!(key in streaks)) streaks[key] = streak;
  }
  return { open, resolve, streaks };
}
