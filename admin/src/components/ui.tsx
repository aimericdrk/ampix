'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Polls a JSON endpoint every `intervalMs`, pausing while the tab is hidden. */
export function usePoll<T>(
  url: string,
  intervalMs = 10_000,
): { data: T | null; error: string | null; at: Date | null; refresh: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; at: Date | null }>({
    data: null,
    error: null,
    at: null,
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Lets callers force an immediate re-fetch after a mutation instead of waiting out the interval.
  // Held in a ref (not returned from the effect) so the identity stays stable across renders.
  const forceTick = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    const tick = async (force = false): Promise<void> => {
      // Interval ticks pause while the tab is hidden, but the FIRST fetch must always run —
      // otherwise a page opened in a background tab renders empty forever.
      if (!force && document.hidden) return;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T;
        if (!cancelled) setState({ data, error: null, at: new Date() });
      } catch (e) {
        if (!cancelled)
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : 'failed',
            at: new Date(),
          }));
      }
    };
    forceTick.current = () => void tick(true);
    void tick(true);
    timer.current = setInterval(() => void tick(), intervalMs);
    const onVisible = (): void => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      forceTick.current = () => {};
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url, intervalMs]);
  const refresh = useCallback(() => forceTick.current(), []);
  return { ...state, refresh };
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log2(Math.abs(n)) / 10));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtCores(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n < 1 ? `${Math.round(n * 1000)}m` : n.toFixed(2);
}

export function fmtPercent(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(0)}%`;
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 90 * 60) return `${Math.round(s / 60)}m`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function Dot({ ok }: { ok: boolean | null }): React.ReactElement {
  const cls = ok === null ? 'bg-zinc-600' : ok ? 'bg-emerald-500' : 'bg-red-500';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

export function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

export function Meter({
  used,
  total,
  label,
}: {
  used: number | null;
  total: number | null;
  label: string;
}) {
  const pct = used !== null && total ? Math.min(100, (used / total) * 100) : null;
  const color =
    pct === null
      ? 'bg-zinc-700'
      : pct > 90
        ? 'bg-red-500'
        : pct > 75
          ? 'bg-amber-500'
          : 'bg-emerald-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span>{pct === null ? '—' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${color}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-2 py-3 text-zinc-500">
                Nothing to show.
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                {cells.map((c, j) => (
                  <td key={j} className="px-2 py-1.5 align-middle">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorBanner({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {text}
    </p>
  );
}
