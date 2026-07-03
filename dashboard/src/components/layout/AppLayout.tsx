import { Link, Outlet, useRouter } from '@tanstack/react-router';
import { logout } from '../../features/auth/api';
import { useAuth } from '../../features/auth/store';
import { Button } from '../ui/button';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ThemeToggle } from './ThemeToggle';

const UPCOMING_SECTIONS = [
  'Insights',
  'Funnels',
  'Retention',
  'Flows',
  'Users',
  'Cohorts',
  'Dashboards',
] as const;

export function AppLayout() {
  const { user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout(); // clears the session even on server failure
    router.history.push('/login');
  };

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="flex w-60 flex-col border-r border-border bg-surface p-4">
        <div className="mb-6 text-lg font-semibold">MyAmpMix</div>
        <ProjectSwitcher />
        <nav aria-label="Primary" className="mt-6 flex-1">
          <Link
            to="/projects"
            className="block rounded-md px-3 py-2 text-sm hover:bg-border/40 [&.active]:bg-border/40 [&.active]:font-medium"
          >
            Projects
          </Link>
          <ul aria-label="Coming soon" className="mt-4 space-y-1 text-sm text-text-muted">
            {UPCOMING_SECTIONS.map((section) => (
              <li key={section} className="px-3 py-1">
                {section} <span className="text-xs">(soon)</span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto space-y-2 border-t border-border pt-4">
          <ThemeToggle />
          <div className="truncate px-3 text-xs text-text-muted">{user?.email}</div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => void handleLogout()}
          >
            Log out
          </Button>
        </div>
      </aside>
      <main id="main-content" className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
