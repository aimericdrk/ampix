import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  await requireSession();
  const { action } = await searchParams;
  const events = await prisma.adminAuditEvent.findMany({
    where: action ? { action } : undefined,
    orderBy: { at: 'desc' },
    take: 200,
    include: { actor: { select: { email: true } } },
  });
  const actions = ['login.success', 'login.fail', 'login.locked', 'logout', 'logout_all', 'user.create', 'user.disable', 'user.enable', 'user.reset_password', 'password.change', 'session.revoke'];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <form className="text-sm">
          <select
            name="action"
            defaultValue={action ?? ''}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5"
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button className="ml-2 rounded-md border border-zinc-700 px-2 py-1.5 hover:bg-zinc-900">Filter</button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              {['When', 'Action', 'Actor', 'IP', 'Detail'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-zinc-900">
                <td className="whitespace-nowrap px-3 py-1.5 text-zinc-400">{e.at.toISOString().replace('T', ' ').slice(0, 19)}</td>
                <td className="px-3 py-1.5 font-medium">{e.action}</td>
                <td className="px-3 py-1.5">{e.actor?.email ?? '—'}</td>
                <td className="px-3 py-1.5 text-zinc-400">{e.ip}</td>
                <td className="px-3 py-1.5 text-zinc-400">{JSON.stringify(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
