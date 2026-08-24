'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import QRCode from 'qrcode';

type Phase =
  | { step: 'idle' }
  | { step: 'confirm'; secret: string; otpauth: string; qr: string | null }
  | { step: 'done'; recoveryCodes: string[] };

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function TotpCard({ enabled, available }: { enabled: boolean; available: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [disableForm, setDisableForm] = useState({ currentPassword: '', code: '' });

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Two-factor authentication</h2>
      {error ? <p className="mb-3 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      {!available ? (
        <p className="text-sm text-zinc-500">Unavailable — TOTP_ENC_KEY is not configured on the server.</p>
      ) : enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-400">Enabled — a code is required at every sign-in.</p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void post('/api/account/totp/disable', disableForm).then(({ ok, data }) => {
                if (!ok) setError(String(data.error ?? 'failed'));
                else router.refresh();
              });
            }}
          >
            <label className="text-sm">
              <span className="block text-xs text-zinc-400">Current password</span>
              <input required type="password" value={disableForm.currentPassword}
                onChange={(e) => setDisableForm({ ...disableForm, currentPassword: e.target.value })}
                className="mt-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-zinc-400">Code (or recovery code)</span>
              <input required value={disableForm.code}
                onChange={(e) => setDisableForm({ ...disableForm, code: e.target.value })}
                className="mt-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <button className="rounded-md border border-red-900 px-3 py-2 text-sm text-red-300 hover:bg-red-950/50">
              Disable 2FA
            </button>
          </form>
        </div>
      ) : phase.step === 'idle' ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Protect sign-in with an authenticator app (TOTP).</p>
          <button
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
            onClick={() =>
              void post('/api/account/totp/setup', {}).then(async ({ ok, data }) => {
                if (!ok) return setError(String(data.error ?? 'failed'));
                setError(null);
                const otpauth = String(data.otpauth);
                const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 192 }).catch(() => null);
                setPhase({ step: 'confirm', secret: String(data.secret), otpauth, qr });
              })
            }
          >
            Set up 2FA
          </button>
        </div>
      ) : phase.step === 'confirm' ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Scan with your authenticator app, then enter the current code to activate:</p>
          {phase.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={phase.qr} alt="TOTP enrolment QR code" className="rounded-md border border-zinc-700 bg-white p-1" />
          ) : null}
          <p className="break-all font-mono text-xs text-zinc-500">Manual entry: {phase.secret}</p>
          <form
            className="flex items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void post('/api/account/totp/enable', { code }).then(({ ok, data }) => {
                if (!ok) return setError(String(data.error ?? 'failed'));
                setError(null);
                setPhase({ step: 'done', recoveryCodes: (data.recoveryCodes as string[]) ?? [] });
              });
            }}
          >
            <input required inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 tracking-widest" />
            <button className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white">Activate</button>
          </form>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-emerald-400">Two-factor is now enabled.</p>
          <p className="text-sm text-amber-300">
            Save these recovery codes now — they are shown once and each works a single time:
          </p>
          <pre className="rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm">{phase.recoveryCodes.join('\n')}</pre>
          <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900" onClick={() => router.refresh()}>
            Done
          </button>
        </div>
      )}
    </section>
  );
}
