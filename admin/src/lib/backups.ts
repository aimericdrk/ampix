import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from './env';
import {
  EXPECTED_DATABASES,
  FILE_RE,
  isSafeBackupName,
  parseStamp,
  summarize,
  type BackupFile,
  type BackupReport,
  type LastRun,
} from './backups-shared';

/**
 * Backup visibility and control for the ops console (Backups page). SERVER ONLY — it touches the
 * filesystem; client components must import the pure helpers from ./backups-shared instead.
 *
 * The backups are produced on the HOST by scripts/ops/backup.sh (systemd timer, 03:30 UTC). This
 * pod sees them through a bind mount at BACKUP_DIR. It deliberately does NOT re-implement dumping:
 * a second implementation would drift from the scheduled one. Instead, "Run now" drops a marker
 * file that a systemd .path unit on the host watches, so there is exactly one backup implementation
 * and the on-demand run is byte-for-byte the nightly run.
 *
 * Unset/missing BACKUP_DIR degrades to `available: false` rather than throwing — the page then
 * explains the mount is missing, mirroring how the Docker page handles an absent socket.
 */

const STATUS_FILE = '.last-run.json';
const TRIGGER_FILE = '.run-now';

export * from './backups-shared';

function backupDir(): string | null {
  const dir = loadEnv().BACKUP_DIR;
  return dir && dir.trim() !== '' ? dir : null;
}

/** Absolute path for a backup file, or null if the name is not a legitimate backup filename. */
export function resolveBackupPath(name: string): string | null {
  const dir = backupDir();
  if (!dir || !isSafeBackupName(name)) return null;
  const full = path.join(dir, 'postgres', name);
  // Belt and braces: even with the name validated, never hand back a path outside the tree.
  if (!full.startsWith(path.join(dir, 'postgres') + path.sep)) return null;
  return full;
}

async function readLastRun(dir: string): Promise<LastRun | null> {
  try {
    const raw = await readFile(path.join(dir, STATUS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as LastRun;
    return typeof parsed?.status === 'string' ? parsed : null;
  } catch {
    // No status file yet (never run since the feature landed), or unreadable — not an error.
    return null;
  }
}

export async function backupReport(now: number = Date.now()): Promise<BackupReport> {
  const dir = backupDir();
  const empty = {
    files: [],
    databases: [],
    totalBytes: 0,
    lastRun: null,
    stalestHours: null,
    missingDatabases: [...EXPECTED_DATABASES],
    runPending: false,
    retentionDays: 30,
  };
  if (!dir) {
    return {
      available: false,
      reason: 'BACKUP_DIR is not set — enable admin.backups in the chart values',
      dir: '',
      ...empty,
    };
  }

  let names: string[];
  try {
    names = await readdir(path.join(dir, 'postgres'));
  } catch (e) {
    const reason =
      (e as NodeJS.ErrnoException).code === 'ENOENT' ? `${dir}/postgres does not exist` : String(e);
    return { available: false, reason, dir, ...empty };
  }

  const files: BackupFile[] = [];
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m?.groups) continue;
    const createdAt = parseStamp(m.groups.stamp);
    if (!createdAt) continue;
    let sizeBytes = 0;
    try {
      sizeBytes = (await stat(path.join(dir, 'postgres', name))).size;
    } catch {
      continue; // vanished between readdir and stat (a prune ran) — just skip it
    }
    files.push({
      name,
      database: m.groups.db,
      createdAt,
      ageHours: (now - Date.parse(createdAt)) / 3_600_000,
      sizeBytes,
    });
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const databases = summarize(files);
  const lastRun = await readLastRun(dir);
  const present = new Set(databases.map((d) => d.database));
  const missingDatabases = EXPECTED_DATABASES.filter((d) => !present.has(d));
  // A database with NO backup is infinitely stale, but there is no number for that — report the
  // worst *measurable* age and let missingDatabases carry the stronger signal.
  const stalestHours =
    databases.length === 0 ? null : Math.max(...databases.map((d) => d.latestAgeHours ?? 0));

  let runPending = false;
  try {
    await stat(path.join(dir, TRIGGER_FILE));
    runPending = true;
  } catch {
    runPending = false;
  }

  return {
    available: true,
    dir,
    retentionDays: lastRun?.retentionDays ?? 30,
    runPending,
    files,
    databases,
    totalBytes: files.reduce((acc, f) => acc + f.sizeBytes, 0),
    lastRun,
    stalestHours,
    missingDatabases,
  };
}

export class BackupError extends Error {}

/**
 * Asks the host to run a backup by dropping the marker the systemd .path unit watches. Returns
 * without waiting: the run takes seconds and the page polls, so blocking the request would only
 * make the UI feel stuck.
 */
export async function requestBackupRun(actorEmail: string): Promise<void> {
  const dir = backupDir();
  if (!dir) throw new BackupError('backup directory is not mounted');
  try {
    await writeFile(path.join(dir, TRIGGER_FILE), `admin console (${actorEmail})\n`, {
      mode: 0o644,
    });
  } catch (e) {
    throw new BackupError(`could not request a run: ${(e as Error).message}`);
  }
}

export async function deleteBackup(name: string): Promise<void> {
  const full = resolveBackupPath(name);
  if (!full) throw new BackupError('not a valid backup file name');
  try {
    await unlink(full);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      throw new BackupError('backup no longer exists');
    throw new BackupError(`could not delete: ${(e as Error).message}`);
  }
}

/** Opens a backup for download. Caller is responsible for auth. */
export async function openBackup(
  name: string,
): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number }> {
  const full = resolveBackupPath(name);
  if (!full) throw new BackupError('not a valid backup file name');
  const info = await stat(full).catch(() => null);
  if (!info) throw new BackupError('backup no longer exists');
  return { stream: createReadStream(full), sizeBytes: info.size };
}
