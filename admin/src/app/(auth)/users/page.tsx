import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { UsersClient, type UserRow } from '@/components/users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const { user } = await requireSession();
  const users = await prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    disabled: u.disabled,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt.toISOString(),
    isSelf: u.id === user.id,
  }));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <UsersClient users={rows} />
    </div>
  );
}
