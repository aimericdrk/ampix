'use client';

import Link from 'next/link';
import { usePoll } from '@/components/ui';

interface AlertsPayload {
  open: Array<{ id: string }>;
}

/** Nav badge: open-alert count, polled every 30 s (v2 design Phase 3). */
export function AlertBadge() {
  const { data } = usePoll<AlertsPayload>('/api/admin/alerts', 30_000);
  const n = data?.open.length ?? 0;
  return (
    <Link
      href="/alerts"
      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
    >
      <span>Alerts</span>
      {n > 0 ? (
        <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{n}</span>
      ) : (
        <span className="text-xs text-zinc-600">0</span>
      )}
    </Link>
  );
}
