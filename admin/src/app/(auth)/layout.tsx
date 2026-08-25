import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth';
import { AlertBadge } from '@/components/alert-badge';

// Everything behind auth is per-request (session cookie + live data) — never prerendered.
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/metrics', label: 'Metrics' },
  { href: '/logs', label: 'Logs' },
  { href: '/kubernetes', label: 'Kubernetes' },
  { href: '/docker', label: 'Docker' },
  { href: '/datastores', label: 'Datastores' },
  { href: '/backups', label: 'Backups' },
  { href: '/audit', label: 'Audit log' },
  { href: '/account', label: 'My account' },
] as const;

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  // Forced first-login password change (design §3.7): everything but /account funnels there.
  const path = (await headers()).get('x-pathname') ?? '/';
  if (user.mustChangePassword && !path.startsWith('/account')) {
    redirect('/account?pw=1');
  }
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-6 px-2">
          <div className="font-semibold tracking-tight">MyAmpix Ops</div>
          <div className="truncate text-xs text-zinc-500">{user.email}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
            >
              {n.label}
            </Link>
          ))}
          <AlertBadge />
          <Link href="/users" className="rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white">Users</Link>
        </nav>
        <form action="/api/auth/logout" method="post">
          <button className="w-full rounded-md border border-zinc-800 px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white">
            Sign out
          </button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
