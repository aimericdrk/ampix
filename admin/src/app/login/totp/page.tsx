import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadEnv } from '@/lib/env';
import { sessionCookieName, validateSessionToken } from '@/lib/session';
import { verifyTotpLogin } from '@/lib/totp-account';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

async function verify(formData: FormData): Promise<void> {
  'use server';
  const env = loadEnv();
  const token = (await cookies()).get(sessionCookieName(env.COOKIE_SECURE))?.value ?? '';
  const auth = await validateSessionToken(prisma, token, new Date(), { allowPending: true });
  if (!auth) redirect('/login?stale=1');
  if (!auth.session.totpPendingUntil) redirect('/');
  const h = await headers();
  const result = await verifyTotpLogin(
    prisma,
    auth.session,
    auth.user,
    String(formData.get('code') ?? ''),
    clientIpFrom(h as unknown as Headers),
  );
  if (!result.ok) redirect(result.revoked ? '/login?stale=1' : '/login/totp?e=1');
  redirect(auth.user.mustChangePassword ? '/account?pw=1' : '/');
}

export default async function TotpPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  // No pending session → nothing to verify here.
  const env = loadEnv();
  const token = (await cookies()).get(sessionCookieName(env.COOKIE_SECURE))?.value ?? '';
  const auth = await validateSessionToken(prisma, token, new Date(), { allowPending: true });
  if (!auth) redirect('/login?stale=1');
  if (!auth.session.totpPendingUntil) redirect('/');
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-semibold tracking-tight">Two-factor check</div>
          <div className="mt-1 text-sm text-zinc-400">Enter the 6-digit code from your authenticator app — or a recovery code.</div>
        </div>
        <form action={verify} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          {e ? (
            <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
              That code is not valid.
            </p>
          ) : null}
          <input
            name="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456 or xxxxx-xxxxx"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-zinc-400"
          />
          <button className="w-full rounded-md bg-zinc-100 px-3 py-2 font-medium text-zinc-950 hover:bg-white">
            Verify
          </button>
        </form>
      </div>
    </main>
  );
}
