'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBanner, usePoll } from '@/components/ui';
import type { LogLine, LogSources } from '@/lib/logs';

const TAILS = [100, 500, 1000, 2000] as const;
const WINDOWS = [
  { label: 'all', seconds: 0 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
] as const;

type Source =
  | { type: 'k8s'; pod: string; container: string }
  | { type: 'docker'; id: string };

export default function LogsPage() {
  const { data: sources, error: sourcesError } = usePoll<LogSources>('/api/admin/logs/sources', 30_000);
  const [source, setSource] = useState<Source | null>(null);
  const [tail, setTail] = useState<number>(500);
  const [windowSec, setWindowSec] = useState<number>(0);
  const [previous, setPrevious] = useState(false);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Default to the first running pod once sources arrive.
  useEffect(() => {
    if (!source && sources && sources.kubernetes.length > 0) {
      const first = sources.kubernetes.find((k) => k.phase === 'Running') ?? sources.kubernetes[0]!;
      setSource({ type: 'k8s', pod: first.pod, container: first.containers[0] ?? '' });
    }
  }, [sources, source]);

  const url = useMemo(() => {
    if (!source) return null;
    const p = new URLSearchParams({ tail: String(tail) });
    if (windowSec > 0) p.set('since', String(windowSec));
    if (source.type === 'k8s') {
      p.set('type', 'k8s');
      p.set('pod', source.pod);
      if (source.container) p.set('container', source.container);
      if (previous) p.set('previous', '1');
    } else {
      p.set('type', 'docker');
      p.set('id', source.id);
    }
    return `/api/admin/logs?${p}`;
  }, [source, tail, windowSec, previous]);

  // Fetch (and re-fetch while following).
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const data = (await res.json()) as { lines?: LogLine[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(data.error ?? `HTTP ${res.status}`);
          setLines([]);
        } else {
          setFetchError(null);
          setLines(data.lines ?? []);
          setLoadedAt(new Date());
        }
      } catch (e) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : 'failed');
      }
    };
    void load();
    if (!follow) return () => { cancelled = true; };
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [url, follow]);

  // Stick to the bottom while following.
  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, follow]);

  const visible = useMemo(() => {
    if (!filter) return lines;
    const f = filter.toLowerCase();
    return lines.filter((l) => l.text.toLowerCase().includes(f));
  }, [lines, filter]);

  const selectValue = source ? (source.type === 'k8s' ? `k8s|${source.pod}|${source.container}` : `docker|${source.id}`) : '';

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col space-y-3">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Logs</h1>
        <span className="text-xs text-zinc-500">
          {loadedAt ? `updated ${loadedAt.toLocaleTimeString()}` : ''} · {visible.length}
          {filter ? `/${lines.length}` : ''} lines
        </span>
      </header>
      {sourcesError ? <ErrorBanner text={`Failed to list sources: ${sourcesError}`} /> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={selectValue}
          onChange={(e) => {
            const [kind, a, b] = e.target.value.split('|');
            setPrevious(false);
            setSource(kind === 'docker' ? { type: 'docker', id: a! } : { type: 'k8s', pod: a!, container: b ?? '' });
          }}
          className="max-w-96 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5"
        >
          {(sources?.kubernetes ?? []).length > 0 ? (
            <optgroup label="Kubernetes pods">
              {(sources?.kubernetes ?? []).flatMap((k) =>
                k.containers.map((c) => (
                  <option key={`${k.pod}|${c}`} value={`k8s|${k.pod}|${c}`}>
                    {k.deployment ?? '·'} / {k.pod}
                    {k.containers.length > 1 ? ` [${c}]` : ''} ({k.phase}
                    {k.restarts > 0 ? `, ${k.restarts}↻` : ''})
                  </option>
                )),
              )}
            </optgroup>
          ) : null}
          {(sources?.docker ?? []).length > 0 ? (
            <optgroup label="Docker (host)">
              {(sources?.docker ?? []).map((d) => (
                <option key={d.id} value={`docker|${d.id}`}>
                  {d.name} ({d.state})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <select value={tail} onChange={(e) => setTail(Number(e.target.value))} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5">
          {TAILS.map((t) => (
            <option key={t} value={t}>last {t}</option>
          ))}
        </select>
        <select value={windowSec} onChange={(e) => setWindowSec(Number(e.target.value))} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5">
          {WINDOWS.map((w) => (
            <option key={w.label} value={w.seconds}>{w.label}</option>
          ))}
        </select>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter lines…"
          className="w-48 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5"
        />
        {source?.type === 'k8s' ? (
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} />
            previous container
          </label>
        ) : null}
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          follow (5s)
        </label>
      </div>
      {fetchError ? <ErrorBanner text={fetchError} /> : null}
      <div
        ref={boxRef}
        className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-5"
      >
        {visible.length === 0 ? (
          <p className="text-zinc-600">{fetchError ? '—' : 'No log lines.'}</p>
        ) : (
          visible.map((l, i) => (
            <div key={i} className="flex gap-3 whitespace-pre-wrap break-all hover:bg-zinc-900/60">
              <span className="shrink-0 select-none text-zinc-600">
                {l.ts ? l.ts.replace(/^\d{4}-\d{2}-\d{2}T/, '').replace(/\.\d+Z?$/, '') : '·'}
              </span>
              <span className="text-zinc-300">{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
