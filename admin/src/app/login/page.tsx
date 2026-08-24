import { redirect } from 'next/navigation';
import { attemptLogin, requestMeta } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadEnv } from '@/lib/env';
import { sessionCookie } from '@/lib/session';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function login(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const { ip, userAgent } = await requestMeta();
  const result = await attemptLogin(prisma, email, password, ip, userAgent);
  if (!result.ok) {
    redirect('/login?e=1');
  }
  const env = loadEnv();
  const c = sessionCookie(result.token, env.COOKIE_SECURE);
  (await cookies()).set(c.name, c.value, c);
  redirect(result.mustChangePassword ? '/account?pw=1' : '/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-semibold tracking-tight">MyAmpix Ops</div>
          <div className="mt-1 text-sm text-zinc-400">Operations console — sign in</div>
        </div>
        <form action={login} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          {e ? (
            <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
              Invalid credentials, or the account is temporarily locked.
            </p>
          ) : null}
          <label className="block text-sm">
            <span className="text-zinc-400">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-400"
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-400"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-zinc-100 px-3 py-2 font-medium text-zinc-950 hover:bg-white"
          >
            Sign in
          </button>
          <p className="text-center text-xs text-zinc-500">
            No self-registration — accounts are created by an administrator.
          </p>
        </form>
      </div>
    </main>
  );
}
