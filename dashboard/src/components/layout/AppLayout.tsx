import { Outlet } from '@tanstack/react-router';

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r border-border bg-surface p-4" aria-label="Primary">
        <div className="text-lg font-semibold">MyAmpMix</div>
      </aside>
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
