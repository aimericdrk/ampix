import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AccountClient, type SessionRow } from '@/components/account-client';
import { TotpCard } from '@/components/totp-client';
import { totpAvailable } from '@/lib/totp-account';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const { user, session } = await requireSession();
  const sessions = await prisma.adminSession.findMany({
    where: { userId: user.id, revokedAt: null, idleExpiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    current: s.id === session.id,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    ip: s.ip,
    userAgent: s.userAgent,
  }));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My account</h1>
      <p className="text-sm text-zinc-400">{user.displayName} · {user.email}</p>
      <AccountClient sessions={rows} mustChange={user.mustChangePassword} />
      <TotpCard enabled={user.totpEnabledAt !== null} available={totpAvailable()} />
    </div>
  );
}
