/**
 * Pure backup types and helpers — no Node built-ins, so this module is safe to import from client
 * components. The filesystem/env side lives in ./backups (server only): importing that from a
 * 'use client' file drags `node:fs`/`node:path` into the browser bundle and fails the build.
 */

/** `<database>-<YYYYMMDDTHHMMSSZ>.dump`, as written by scripts/ops/backup.sh. */
export const FILE_RE = /^(?<db>[a-z0-9_]+)-(?<stamp>\d{8}T\d{6}Z)\.dump$/;

export interface BackupFile {
  name: string;
  database: string;
  createdAt: string; // ISO, parsed from the filename stamp (not mtime — the stamp is authoritative)
  ageHours: number;
  sizeBytes: number;
}

export interface BackupRunResult {
  database: string;
  status: 'ok' | 'fail';
  bytes: number;
}

export interface LastRun {
  finishedAt: string;
  startedAt: string;
  durationSeconds: number;
  status: 'ok' | 'failed';
  triggeredBy: string;
  retentionDays: number;
  prunedCount: number;
  results: BackupRunResult[];
}

export interface DatabaseSummary {
  database: string;
  count: number;
  totalBytes: number;
  latestAt: string | null;
  latestAgeHours: number | null;
}

export interface BackupReport {
  available: boolean;
  reason?: string;
  dir: string;
  retentionDays: number;
  /** Set while a requested run has not been picked up by the host watcher yet. */
  runPending: boolean;
  files: BackupFile[];
  databases: DatabaseSummary[];
  totalBytes: number;
  lastRun: LastRun | null;
  /** Oldest of the per-database latest ages — the honest "how stale are we" number. */
  stalestHours: number | null;
  /** Databases backup.sh dumps that have no backup at all. */
  missingDatabases: string[];
}

/**
 * Databases the scheduled backup covers. Declared here so the page can flag a database that has
 * NO backup at all — a case an inventory of existing files can never surface on its own.
 */
export const EXPECTED_DATABASES = ['myampix', 'admin_console', 'mobile_purchase'] as const;

/** Filename stamp (20260825T001145Z) → ISO instant. Returns null if it is not a real date. */
export function parseStamp(stamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  // Date.parse normalises overflow (month 13 → next year), so round-trip to reject impossible dates.
  const back = new Date(parsed).toISOString();
  return back.slice(0, 19) + 'Z' === iso ? back : null;
}

/** Rejects anything that is not a plain backup filename — no separators, no traversal, no dotfiles. */
export function isSafeBackupName(name: string): boolean {
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  return FILE_RE.test(name);
}

export function summarize(files: BackupFile[]): DatabaseSummary[] {
  const byDb = new Map<string, BackupFile[]>();
  for (const f of files) {
    const list = byDb.get(f.database) ?? [];
    list.push(f);
    byDb.set(f.database, list);
  }
  return [...byDb.entries()]
    .map(([database, list]) => {
      const latest = list.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
      return {
        database,
        count: list.length,
        totalBytes: list.reduce((acc, f) => acc + f.sizeBytes, 0),
        latestAt: latest.createdAt,
        latestAgeHours: latest.ageHours,
      };
    })
    .sort((a, b) => a.database.localeCompare(b.database));
}

/** The pg_restore invocation for a given file — shown in the UI so restores are copy-paste. */
export function restoreCommand(file: BackupFile): string {
  const container =
    file.database === 'mobile_purchase'
      ? 'myampix-mobile-purchase-postgres-1'
      : 'myampix-postgres-1';
  const user = file.database === 'mobile_purchase' ? 'mobile_purchase' : 'myampix';
  return `docker exec -i ${container} pg_restore -U ${user} -d ${file.database} --clean --if-exists < /var/backups/myampix/postgres/${file.name}`;
}
