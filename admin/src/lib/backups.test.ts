import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupReport,
  deleteBackup,
  EXPECTED_DATABASES,
  isSafeBackupName,
  parseStamp,
  requestBackupRun,
  resolveBackupPath,
  restoreCommand,
  summarize,
  type BackupFile,
} from './backups';
import { resetEnvCache } from './env';

const NOW = Date.parse('2026-08-25T12:00:00Z');

// loadEnv() validates the WHOLE admin environment, so BACKUP_DIR alone is not enough to construct
// a valid one — DATABASE_URL is required. Set once for the file; individual tests only vary
// BACKUP_DIR.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  resetEnvCache();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEnvCache();
});

/** Builds a temp backup tree and points BACKUP_DIR at it, the way the chart's mount would. */
async function makeTree(files: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'myampix-backups-'));
  await mkdir(path.join(dir, 'postgres'), { recursive: true });
  for (const f of files) await writeFile(path.join(dir, 'postgres', f), 'x'.repeat(100));
  return dir;
}

describe('parseStamp', () => {
  it('parses the filename stamp into an ISO instant', () => {
    expect(parseStamp('20260825T001145Z')).toBe('2026-08-25T00:11:45.000Z');
  });

  it('rejects malformed and impossible stamps', () => {
    expect(parseStamp('nonsense')).toBeNull();
    expect(parseStamp('2026-08-25')).toBeNull();
    expect(parseStamp('20261325T001145Z')).toBeNull(); // month 13
  });
});

describe('isSafeBackupName / resolveBackupPath', () => {
  it('accepts a real backup filename', () => {
    expect(isSafeBackupName('myampix-20260825T001145Z.dump')).toBe(true);
    expect(isSafeBackupName('mobile_purchase-20260825T001145Z.dump')).toBe(true);
  });

  // These are the inputs that would turn "delete a backup" into arbitrary file deletion.
  it.each([
    '../../../etc/passwd',
    '/etc/passwd',
    'myampix-20260825T001145Z.dump/../../evil',
    '..%2Fetc%2Fpasswd',
    '.last-run.json',
    'myampix-20260825T001145Z.dump\0.png',
    'subdir/myampix-20260825T001145Z.dump',
    'myampix.dump',
    '',
  ])('rejects %j', (bad) => {
    expect(isSafeBackupName(bad)).toBe(false);
  });

  it('returns null for an unsafe name even when BACKUP_DIR is set', async () => {
    process.env.BACKUP_DIR = await makeTree([]);
    resetEnvCache();
    expect(resolveBackupPath('../../etc/passwd')).toBeNull();
    expect(resolveBackupPath('myampix-20260825T001145Z.dump')).not.toBeNull();
  });
});

describe('summarize', () => {
  const f = (
    database: string,
    createdAt: string,
    sizeBytes: number,
    ageHours: number,
  ): BackupFile => ({
    name: `${database}-x.dump`,
    database,
    createdAt,
    ageHours,
    sizeBytes,
  });

  it('groups by database and reports the newest as latest', () => {
    const out = summarize([
      f('myampix', '2026-08-24T00:00:00.000Z', 10, 36),
      f('myampix', '2026-08-25T00:00:00.000Z', 20, 12),
      f('admin_console', '2026-08-25T00:00:00.000Z', 5, 12),
    ]);
    expect(out.map((d) => d.database)).toEqual(['admin_console', 'myampix']); // sorted
    const my = out.find((d) => d.database === 'myampix')!;
    expect(my.count).toBe(2);
    expect(my.totalBytes).toBe(30);
    expect(my.latestAt).toBe('2026-08-25T00:00:00.000Z');
    expect(my.latestAgeHours).toBe(12);
  });

  it('returns nothing for no files', () => {
    expect(summarize([])).toEqual([]);
  });
});

describe('backupReport', () => {
  it('degrades gracefully when the directory is not mounted', async () => {
    delete process.env.BACKUP_DIR;
    resetEnvCache();
    const r = await backupReport(NOW);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/BACKUP_DIR/);
    // Every database counts as missing, but this must NOT be reported as a healthy empty set.
    expect(r.missingDatabases).toEqual([...EXPECTED_DATABASES]);
    expect(r.files).toEqual([]);
  });

  it('degrades gracefully when the path exists in config but not on disk', async () => {
    process.env.BACKUP_DIR = path.join(tmpdir(), 'definitely-not-here-myampix');
    resetEnvCache();
    const r = await backupReport(NOW);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/does not exist/);
  });

  it('inventories files, ages them, and flags databases with no backup', async () => {
    process.env.BACKUP_DIR = await makeTree([
      'myampix-20260825T000000Z.dump', // 12h old
      'myampix-20260824T000000Z.dump', // 36h old
      'admin_console-20260825T000000Z.dump',
      'not-a-backup.txt', // ignored
      'README', // ignored
    ]);
    resetEnvCache();
    const r = await backupReport(NOW);

    expect(r.available).toBe(true);
    expect(r.files).toHaveLength(3);
    // Newest first.
    expect(r.files[0].createdAt > r.files[r.files.length - 1].createdAt).toBe(true);
    const newest = r.files.find((f) => f.name === 'myampix-20260825T000000Z.dump')!;
    expect(newest.ageHours).toBeCloseTo(12, 5);
    expect(newest.database).toBe('myampix');
    expect(r.totalBytes).toBe(300);
    // mobile_purchase has no file at all — the case an inventory alone would hide.
    expect(r.missingDatabases).toEqual(['mobile_purchase']);
    expect(r.stalestHours).toBeCloseTo(12, 5);
  });

  it('reports stalestHours as the WORST database, not the newest file overall', async () => {
    process.env.BACKUP_DIR = await makeTree([
      'myampix-20260825T000000Z.dump', // 12h — fresh
      'admin_console-20260820T000000Z.dump', // 132h — stale
    ]);
    resetEnvCache();
    const r = await backupReport(NOW);
    // A naive "newest file" would say 12h and hide that admin_console has not been backed up in days.
    expect(r.stalestHours).toBeCloseTo(132, 5);
  });

  it('surfaces a queued run and the last-run status file', async () => {
    const dir = await makeTree(['myampix-20260825T000000Z.dump']);
    await writeFile(path.join(dir, '.run-now'), 'admin console (a@b.c)');
    await writeFile(
      path.join(dir, '.last-run.json'),
      JSON.stringify({
        finishedAt: '2026-08-25T00:11:45Z',
        startedAt: '2026-08-25T00:11:45Z',
        durationSeconds: 3,
        status: 'ok',
        triggeredBy: 'schedule',
        retentionDays: 30,
        prunedCount: 1,
        results: [{ database: 'myampix', status: 'ok', bytes: 100 }],
      }),
    );
    process.env.BACKUP_DIR = dir;
    resetEnvCache();
    const r = await backupReport(NOW);
    expect(r.runPending).toBe(true);
    expect(r.lastRun?.status).toBe('ok');
    expect(r.lastRun?.prunedCount).toBe(1);
    expect(r.retentionDays).toBe(30);
  });

  it('survives a corrupt status file rather than failing the page', async () => {
    const dir = await makeTree(['myampix-20260825T000000Z.dump']);
    await writeFile(path.join(dir, '.last-run.json'), '{ this is not json');
    process.env.BACKUP_DIR = dir;
    resetEnvCache();
    const r = await backupReport(NOW);
    expect(r.available).toBe(true);
    expect(r.lastRun).toBeNull();
  });
});

describe('mutations', () => {
  it('requestBackupRun drops a marker naming the requester', async () => {
    const dir = await makeTree([]);
    process.env.BACKUP_DIR = dir;
    resetEnvCache();
    await requestBackupRun('ops@example.com');
    const r = await backupReport(NOW);
    expect(r.runPending).toBe(true);
  });

  it('deleteBackup removes only the named file', async () => {
    const dir = await makeTree([
      'myampix-20260825T000000Z.dump',
      'admin_console-20260825T000000Z.dump',
    ]);
    process.env.BACKUP_DIR = dir;
    resetEnvCache();
    await deleteBackup('myampix-20260825T000000Z.dump');
    expect(await readdir(path.join(dir, 'postgres'))).toEqual([
      'admin_console-20260825T000000Z.dump',
    ]);
  });

  it('deleteBackup refuses a traversal attempt', async () => {
    process.env.BACKUP_DIR = await makeTree(['myampix-20260825T000000Z.dump']);
    resetEnvCache();
    await expect(deleteBackup('../../../etc/passwd')).rejects.toThrow(/valid backup file name/);
  });

  it('deleteBackup reports a missing file instead of throwing raw ENOENT', async () => {
    process.env.BACKUP_DIR = await makeTree([]);
    resetEnvCache();
    await expect(deleteBackup('myampix-20260825T000000Z.dump')).rejects.toThrow(/no longer exists/);
  });
});

describe('restoreCommand', () => {
  const file = (database: string): BackupFile => ({
    name: `${database}-20260825T000000Z.dump`,
    database,
    createdAt: '2026-08-25T00:00:00.000Z',
    ageHours: 12,
    sizeBytes: 100,
  });

  it('targets the analytics container for myampix and admin_console', () => {
    expect(restoreCommand(file('myampix'))).toContain('myampix-postgres-1');
    expect(restoreCommand(file('myampix'))).toContain('-U myampix -d myampix');
    expect(restoreCommand(file('admin_console'))).toContain('myampix-postgres-1');
    expect(restoreCommand(file('admin_console'))).toContain('-d admin_console');
  });

  // mobile_purchase is a genuinely separate Postgres with its own container AND its own user —
  // pointing the restore at the wrong one is the mistake this covers.
  it('targets the purchase container and user for mobile_purchase', () => {
    const cmd = restoreCommand(file('mobile_purchase'));
    expect(cmd).toContain('myampix-mobile-purchase-postgres-1');
    expect(cmd).toContain('-U mobile_purchase -d mobile_purchase');
  });
});
