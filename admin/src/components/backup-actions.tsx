'use client';

import { useState } from 'react';
import { restoreCommand, type BackupFile } from '@/lib/backups-shared';

type Notify = (msg: string, ok: boolean) => void;

async function post(url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}

/** Requests an out-of-schedule run. The host picks up the marker within a second or two. */
export function RunBackupButton({
  pending,
  disabled,
  onDone,
}: {
  pending: boolean;
  disabled: boolean;
  onDone: Notify;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    const r = await post('/api/admin/backups/run');
    setBusy(false);
    onDone(
      r.ok
        ? 'Backup requested — it runs on the host within a few seconds.'
        : (r.error ?? 'request failed'),
      r.ok,
    );
  };

  // `pending` comes from the marker file still being on disk: the host has not picked it up yet.
  if (pending) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-amber-300">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
        Run queued…
      </span>
    );
  }
  return (
    <button
      onClick={() => void run()}
      disabled={busy || disabled}
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
    >
      {busy ? 'Requesting…' : 'Run backup now'}
    </button>
  );
}

/** Per-row controls: download, copy the restore command, delete (one-click confirm). */
export function BackupActions({ file, onDone }: { file: BackupFile; onDone: Notify }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const remove = async (): Promise<void> => {
    setBusy(true);
    const r = await post('/api/admin/backups/delete', { name: file.name });
    setBusy(false);
    setConfirming(false);
    onDone(r.ok ? `Deleted ${file.name}` : (r.error ?? 'delete failed'), r.ok);
  };

  const copy = (): void => {
    // navigator.clipboard is undefined on a non-secure origin; degrade to a hint rather than throw.
    if (!navigator.clipboard) {
      onDone('Clipboard unavailable — select the command manually.', false);
      return;
    }
    navigator.clipboard
      .writeText(restoreCommand(file))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => onDone('Could not copy to clipboard', false));
  };

  // Two clicks, no typing. Deleting one dump of many is recoverable in practice (the others remain,
  // and the next run replaces it), so the typed-name gate the org/deployment deletes use would be
  // friction without a matching payoff — these filenames are 36 characters of timestamp.
  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-amber-300">Delete permanently?</span>
        <button
          disabled={busy}
          onClick={() => void remove()}
          className="rounded border border-red-700 px-2 py-0.5 text-xs text-red-300 disabled:opacity-40"
          autoFocus
          aria-label={`Confirm deletion of ${file.name}`}
        >
          {busy ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-3">
      <a
        href={`/api/admin/backups/download?name=${encodeURIComponent(file.name)}`}
        className="text-xs text-zinc-300 hover:underline"
      >
        Download
      </a>
      <button
        onClick={copy}
        className="text-xs text-zinc-300 hover:underline"
        title={restoreCommand(file)}
      >
        {copied ? 'Copied' : 'Copy restore cmd'}
      </button>
      <button onClick={() => setConfirming(true)} className="text-xs text-red-400 hover:underline">
        Delete
      </button>
    </span>
  );
}
