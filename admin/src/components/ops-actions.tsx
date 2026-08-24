'use client';

import { useState } from 'react';

/** Confirmation-gated restart/scale controls for one deployment row (v2 design Phase 2). */
export function DeploymentActions({
  name,
  hpaManaged,
  onDone,
}: {
  name: string;
  hpaManaged: boolean;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [confirming, setConfirming] = useState<null | { action: 'restart' } | { action: 'scale'; replicas: number }>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    if (!confirming) return;
    setBusy(true);
    const url = confirming.action === 'restart' ? '/api/admin/ops/restart' : '/api/admin/ops/scale';
    const body =
      confirming.action === 'restart' ? { deployment: name } : { deployment: name, replicas: confirming.replicas };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setConfirming(null);
    setTyped('');
    onDone(
      res.ok
        ? `${confirming.action === 'restart' ? 'Restarted' : 'Scaled'} ${name}${confirming.action === 'scale' ? ` to ${confirming.replicas}` : ''}`
        : (data.error ?? 'action failed'),
      res.ok,
    );
  };

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-amber-300">
          Type <span className="font-mono">{name}</span> to {confirming.action}
          {confirming.action === 'scale' ? ` → ${confirming.replicas}` : ''}:
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 font-mono text-xs"
          autoFocus
        />
        <button
          disabled={typed !== name || busy}
          onClick={() => void run()}
          className="rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-300 disabled:opacity-40"
        >
          Confirm
        </button>
        <button onClick={() => { setConfirming(null); setTyped(''); }} className="text-xs text-zinc-500 hover:underline">
          Cancel
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button onClick={() => setConfirming({ action: 'restart' })} className="text-xs text-zinc-300 hover:underline">
        Restart
      </button>
      {!hpaManaged ? (
        <ScalePicker onPick={(n) => setConfirming({ action: 'scale', replicas: n })} />
      ) : (
        <span className="text-xs text-zinc-600" title="HPA-managed — adjust autoscaler bounds in values instead">
          scale: HPA
        </span>
      )}
    </span>
  );
}

function ScalePicker({ onPick }: { onPick: (n: number) => void }) {
  const [n, setN] = useState(1);
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-zinc-500">scale</span>
      <input
        type="number"
        min={0}
        max={10}
        value={n}
        onChange={(e) => setN(Number(e.target.value))}
        className="w-12 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5"
      />
      <button onClick={() => onPick(n)} className="text-zinc-300 hover:underline">go</button>
    </span>
  );
}
