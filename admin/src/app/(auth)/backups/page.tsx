'use client';

import { useState } from 'react';
import type { BackupFile, BackupReport } from '@/lib/backups-shared';
import { Card, Dot, ErrorBanner, fmtAgo, fmtBytes, Table, usePoll } from '@/components/ui';
import { BackupActions, RunBackupButton } from '@/components/backup-actions';

/** Age at which a backup set stops being trustworthy: the nightly timer runs every 24h. */
const STALE_HOURS = 36;

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** 03:30 UTC nightly — rendered in the viewer's own zone so "when is the next one" is answerable. */
function nextRunLocal(): string {
  const next = new Date();
  next.setUTCHours(3, 30, 0, 0);
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  const hours = Math.round((next.getTime() - Date.now()) / 360_000) / 10;
  return `${next.toLocaleString()} (in ${hours}h)`;
}

export default function BackupsPage() {
  const { data, error, refresh } = usePoll<BackupReport>('/api/admin/backups', 10_000);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const notify = (msg: string, ok: boolean): void => {
    setToast({ msg, ok });
    void refresh();
    window.setTimeout(() => setToast(null), 6000);
  };

  const stale = data?.stalestHours != null && data.stalestHours > STALE_HOURS;
  const lastFailed = data?.lastRun?.status === 'failed';

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Backups</h1>
        <span className="text-xs text-zinc-500">auto-refresh 10s</span>
      </header>

      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      {data && !data.available ? (
        <ErrorBanner text={`Backup directory unavailable: ${data.reason ?? 'not mounted'}`} />
      ) : null}
      {toast ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            toast.ok
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
              : 'border-red-800 bg-red-950/40 text-red-300'
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      ) : null}

      {/* Problems first: a stale set, a failed run, or a database with no backup at all are the
          three states an operator must never have to go looking for. */}
      {lastFailed ? (
        <ErrorBanner
          text={`Last backup FAILED at ${new Date(data!.lastRun!.finishedAt).toLocaleString()} — check: journalctl -u myampix-backup.service`}
        />
      ) : null}
      {stale ? (
        <ErrorBanner
          text={`Newest backup is ${Math.floor(data!.stalestHours!)}h old (expected under ${STALE_HOURS}h) — the nightly timer may not be running.`}
        />
      ) : null}
      {data?.available && data.missingDatabases.length > 0 ? (
        <ErrorBanner text={`No backup at all for: ${data.missingDatabases.join(', ')}`} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card title="Last run">
          {data?.lastRun ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Dot ok={data.lastRun.status === 'ok'} />
                <span className="font-medium">
                  {data.lastRun.status === 'ok' ? 'Succeeded' : 'Failed'}
                </span>
              </div>
              <div className="text-zinc-400">{fmtAgo(data.lastRun.finishedAt)}</div>
              <div className="text-xs text-zinc-500">
                took {fmtDuration(data.lastRun.durationSeconds)} · by {data.lastRun.triggeredBy}
              </div>
              {data.lastRun.prunedCount > 0 ? (
                <div className="text-xs text-zinc-500">
                  pruned {data.lastRun.prunedCount} expired
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No run recorded yet</div>
          )}
        </Card>

        <Card title="Next scheduled">
          <div className="space-y-1 text-sm">
            <div className="font-medium">03:30 UTC daily</div>
            <div className="text-xs text-zinc-400">{nextRunLocal()}</div>
            <div className="text-xs text-zinc-500">missed runs fire at next boot</div>
          </div>
        </Card>

        <Card title="Stored">
          <div className="space-y-1 text-sm">
            <div className="font-medium">{fmtBytes(data?.totalBytes ?? 0)}</div>
            <div className="text-xs text-zinc-400">{data?.files.length ?? 0} files</div>
            <div className="text-xs text-zinc-500">
              deleted automatically after {data?.retentionDays ?? 30} days
            </div>
          </div>
        </Card>

        <Card title="Run now">
          <div className="space-y-2">
            <RunBackupButton
              pending={data?.runPending ?? false}
              disabled={!data?.available}
              onDone={notify}
            />
            <p className="text-xs text-zinc-500">
              Runs the same script as the nightly timer, on the host.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Per database">
        <Table
          head={['', 'Database', 'Backups', 'Latest', 'Total size']}
          rows={(data?.databases ?? []).map((d) => [
            <Dot key="s" ok={(d.latestAgeHours ?? Infinity) <= STALE_HOURS} />,
            <span key="d" className="font-medium">
              {d.database}
            </span>,
            String(d.count),
            <span
              key="l"
              className={(d.latestAgeHours ?? 0) > STALE_HOURS ? 'text-amber-300' : undefined}
            >
              {fmtAgo(d.latestAt)}
            </span>,
            fmtBytes(d.totalBytes),
          ])}
        />
      </Card>

      <Card title={`All backups (${data?.files.length ?? 0})`}>
        <Table
          head={['File', 'Database', 'Created', 'Size', 'Expires in', '']}
          rows={(data?.files ?? []).map((f: BackupFile) => {
            const daysLeft = Math.max(0, Math.ceil((data!.retentionDays ?? 30) - f.ageHours / 24));
            return [
              <span key="f" className="font-mono text-xs">
                {f.name}
              </span>,
              f.database,
              <span key="c" title={new Date(f.createdAt).toLocaleString()}>
                {fmtAgo(f.createdAt)}
              </span>,
              fmtBytes(f.sizeBytes),
              <span key="e" className={daysLeft <= 3 ? 'text-amber-300' : 'text-zinc-400'}>
                {daysLeft}d
              </span>,
              <BackupActions key="a" file={f} onDone={notify} />,
            ];
          })}
        />
        {data?.available && data.files.length === 0 ? (
          <p className="p-3 text-sm text-zinc-500">No backups yet — use “Run now”.</p>
        ) : null}
      </Card>

      <Card title="Restore">
        <div className="space-y-2 p-1 text-sm text-zinc-400">
          <p>
            Restoring is deliberately not a button: it overwrites a live database and is not
            reversible. Use the copy icon on a row to get its exact{' '}
            <code className="text-zinc-300">pg_restore</code> command, then run it on the host over
            SSH.
          </p>
          <p className="text-xs text-zinc-500">
            Backups live at <code>{data?.dir ?? '/var/backups/myampix'}/postgres</code> on the host.
            ClickHouse events are not backed up (too large, and reconstructible) — take a one-off
            snapshot with <code className="text-zinc-300">BACKUP DATABASE analytics</code> if you
            need one.
          </p>
        </div>
      </Card>
    </div>
  );
}
