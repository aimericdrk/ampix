'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string;
  userAgent: string;
}

export function AccountClient({ sessions, mustChange }: { sessions: SessionRow[]; mustChange: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  return (
    <div className="space-y-6">
      {mustChange ? (
        <p className="rounded-md border border-amber-900 bg-amber-950/60 px-3 py-2 text-sm text-amber-300">
          You must change your password before using the console.
        </p>
      ) : null}
      {msg ? (
        <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-emerald-900 bg-emerald-950/60 text-emerald-300' : 'border-red-900 bg-red-950/60 text-red-300'}`}>
          {msg.text}
        </p>
      ) : null}
      <form
        className="flex max-w-md flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const res = await fetch('/api/account/password', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(pw),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setMsg(res.ok ? { ok: true, text: 'Password changed. Other sessions were signed out.' } : { ok: false, text: data.error ?? 'failed' });
            if (res.ok) {
              setPw({ currentPassword: '', newPassword: '' });
              router.refresh();
            }
          })();
        }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Change password</h2>
        <label className="text-sm">
          <span className="block text-xs text-zinc-400">Current password</span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-400">New password (min 8 characters)</span>
          <input
            required
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
        </label>
        <button className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white">Change password</button>
      </form>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Active sessions</h2>
          <form action="/api/auth/logout-all" method="post">
            <button className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/50">
              Sign out everywhere
            </button>
          </form>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              {['Created', 'Last seen', 'IP', 'Browser', ''].map((h, i) => (
                <th key={i} className="px-2 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-zinc-900">
                <td className="px-2 py-1.5 text-zinc-400">{new Date(s.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1.5 text-zinc-400">{new Date(s.lastSeenAt).toLocaleString()}</td>
                <td className="px-2 py-1.5">{s.ip}{s.current ? <span className="ml-1 text-xs text-emerald-400">(this device)</span> : null}</td>
                <td className="max-w-64 truncate px-2 py-1.5 text-zinc-500">{s.userAgent}</td>
                <td className="px-2 py-1.5">
                  {!s.current ? (
                    <button
                      className="text-xs text-red-400 hover:underline"
                      onClick={() =>
                        void fetch(`/api/sessions/${s.id}/revoke`, { method: 'POST' }).then(() => router.refresh())
                      }
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
