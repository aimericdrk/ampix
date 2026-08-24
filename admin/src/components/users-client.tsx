'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  isSelf: boolean;
}

async function post(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function UsersClient({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '' });

  const run = async (fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>): Promise<void> => {
    setError(null);
    const { ok, data } = await fn();
    if (!ok) setError(String(data.error ?? 'request failed'));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p> : null}
      {notice ? (
        <p className="rounded-md border border-emerald-900 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const res = await post('/api/users', form);
            if (res.ok && res.data.tempPassword) {
              setNotice(`Account created. Temporary password (shown once): ${String(res.data.tempPassword)}`);
              setForm({ email: '', displayName: '' });
            }
            return res;
          });
        }}
      >
        <label className="text-sm">
          <span className="block text-xs text-zinc-400">Email</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-400">Display name</span>
          <input
            required
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
        </label>
        <button className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white">
          Create account
        </button>
        <span className="text-xs text-zinc-500">A one-time temporary password is generated; the user must change it at first login.</span>
      </form>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              {['Email', 'Name', 'Status', 'Created', 'Actions'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-zinc-900">
                <td className="px-3 py-2 font-medium">{u.email}{u.isSelf ? <span className="ml-2 text-xs text-zinc-500">(you)</span> : null}</td>
                <td className="px-3 py-2">{u.displayName}</td>
                <td className="px-3 py-2">
                  {u.disabled ? (
                    <span className="text-red-400">disabled</span>
                  ) : u.mustChangePassword ? (
                    <span className="text-amber-400">password change pending</span>
                  ) : (
                    <span className="text-emerald-400">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {u.disabled ? (
                      <button className="text-xs text-emerald-400 hover:underline" onClick={() => void run(() => post(`/api/users/${u.id}/enable`))}>
                        Enable
                      </button>
                    ) : (
                      <button
                        className="text-xs text-red-400 hover:underline disabled:opacity-40"
                        disabled={u.isSelf}
                        onClick={() => void run(() => post(`/api/users/${u.id}/disable`))}
                      >
                        Disable
                      </button>
                    )}
                    <button
                      className="text-xs text-zinc-300 hover:underline"
                      onClick={() =>
                        void run(async () => {
                          const res = await post(`/api/users/${u.id}/reset-password`);
                          if (res.ok) setNotice(`New temporary password for ${u.email} (shown once): ${String(res.data.tempPassword)}`);
                          return res;
                        })
                      }
                    >
                      Reset password
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
