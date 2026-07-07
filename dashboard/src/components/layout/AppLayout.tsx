import { Link, Outlet, useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { DateRangeProvider } from '../../features/analytics/date-range';
import { logout } from '../../features/auth/api';
import { authStore, useAuth } from '../../features/auth/store';
import { currentOrgStore, useCurrentOrgId } from '../../features/orgs/store';
import { useProjects } from '../../features/projects/api';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { NavIcon, type IconName } from './NavIcon';
import { OrgSwitcher } from './OrgSwitcher';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  label: string;
  to: string;
  icon: IconName;
  /** Match only the exact path (so a parent link isn't active on its children). */
  exact?: boolean;
}

interface NavGroup {
  heading?: string;
  items: NavItem[];
}

/** The grouped project information architecture — one calm, scannable list instead of a tab strip. */
function projectGroups(): NavGroup[] {
  const p = (path: string) => `/projects/$projectId${path}`;
  return [
    {
      items: [{ label: 'Home', to: p('/home'), icon: 'home' }],
    },
    {
      heading: 'Explore',
      items: [
        { label: 'Insights', to: p('/insights'), icon: 'insights' },
        { label: 'Funnels', to: p('/funnels'), icon: 'funnel' },
        { label: 'Retention', to: p('/retention'), icon: 'retention' },
        // "Paths" is the interactive user-path map + Mermaid view (screen-paths, §19).
        { label: 'Paths', to: p('/paths'), icon: 'paths' },
        { label: 'Heatmap', to: p('/heatmap'), icon: 'heatmap' },
      ],
    },
    {
      heading: 'Audience',
      items: [
        { label: 'Cohorts', to: p('/cohorts'), icon: 'cohorts' },
        { label: 'Users', to: p('/users'), icon: 'users' },
        { label: 'Sessions', to: p('/sessions'), icon: 'sessions' },
        { label: 'Live', to: p('/live'), icon: 'live' },
      ],
    },
    {
      heading: 'Saved',
      items: [
        { label: 'Dashboards', to: p('/dashboards'), icon: 'dashboards' },
        { label: 'Reports', to: p('/reports'), icon: 'reports' },
        { label: 'Templates', to: p('/templates'), icon: 'templates' },
      ],
    },
    {
      items: [{ label: 'Project settings', to: p(''), icon: 'settings', exact: true }],
    },
  ];
}

const NAV_LINK_BASE =
  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text-muted transition-colors hover:bg-border/40 hover:text-text';
const NAV_LINK_ACTIVE = 'bg-border/50 font-medium text-text';

function NavLink({ item, projectId }: { item: NavItem; projectId?: string }) {
  return (
    <Link
      to={item.to}
      params={projectId ? { projectId } : undefined}
      activeOptions={{ exact: item.exact ?? false }}
      className={NAV_LINK_BASE}
      activeProps={{ className: NAV_LINK_ACTIVE, 'aria-current': 'page' }}
    >
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  const currentOrgId = useCurrentOrgId();
  const { data: projectsData } = useProjects();
  // Merged params of the active match; present on every project-scoped route.
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const [mobileOpen, setMobileOpen] = useState(false);

  // Switching the workspace must not strand you on another org's project. When
  // the active project provably belongs to a different org than the selected
  // one, fall back to the projects list. Guarded on a positively-matched
  // project so it never fights an in-flight selection or a still-loading query.
  useEffect(() => {
    if (!projectId || !currentOrgId || !projectsData) return;
    const active = projectsData.projects.find((project) => project.id === projectId);
    if (active && active.org_id !== currentOrgId) {
      void navigate({ to: '/projects' });
    }
  }, [projectId, currentOrgId, projectsData, navigate]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // A failed server call must never block local logout.
    } finally {
      authStore.clearSession(); // idempotent — logout() already clears on any outcome
      currentOrgStore.reset(); // don't leak the previous user's org selection
      router.history.push('/login');
    }
  };

  const groups = projectId ? projectGroups() : [];

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Compact top bar on small screens: brand + a menu toggle for the collapsible sidebar. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-2 md:hidden">
        <span className="text-lg font-semibold">MyAmpMix</span>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </Button>
      </div>

      {/* Full-height column: header + bottom cluster stay fixed; only the nav scrolls. */}
      <aside
        id="app-sidebar"
        className={cn(
          'z-40 w-60 shrink-0 flex-col border-r border-border bg-surface',
          'md:flex md:sticky md:top-0 md:h-screen',
          mobileOpen ? 'fixed inset-y-0 left-0 flex' : 'hidden',
        )}
      >
        <div className="flex shrink-0 flex-col gap-3 p-4">
          <div className="hidden text-lg font-semibold md:block">MyAmpMix</div>
          <OrgSwitcher />
          <ProjectSwitcher />
        </div>

        <nav
          aria-label="Primary"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          onClickCapture={() => setMobileOpen(false)}
        >
          <Link
            to="/projects"
            activeOptions={{ exact: true }}
            className={NAV_LINK_BASE}
            activeProps={{ className: NAV_LINK_ACTIVE, 'aria-current': 'page' }}
          >
            <NavIcon name="projects" />
            <span>Projects</span>
          </Link>

          {groups.map((group, index) => (
            <NavSection key={group.heading ?? `group-${index}`} heading={group.heading}>
              {group.items.map((item) => (
                <NavLink key={item.to} item={item} projectId={projectId} />
              ))}
            </NavSection>
          ))}

          {!projectId && (
            <p className="mt-4 px-3 text-xs text-text-muted">
              Pick a project to see its analytics.
            </p>
          )}
        </nav>

        <div className="mt-auto shrink-0 space-y-1 border-t border-border p-4">
          {currentOrgId && (
            <Link
              to="/orgs/$orgId/settings"
              params={{ orgId: currentOrgId }}
              className={NAV_LINK_BASE}
              activeProps={{ className: NAV_LINK_ACTIVE, 'aria-current': 'page' }}
            >
              <NavIcon name="org" />
              <span>Organization settings</span>
            </Link>
          )}
          <Link
            to="/account"
            className={NAV_LINK_BASE}
            activeProps={{ className: NAV_LINK_ACTIVE, 'aria-current': 'page' }}
          >
            <NavIcon name="account" />
            <span>Account</span>
          </Link>
          <Link
            to="/settings/security"
            className={NAV_LINK_BASE}
            activeProps={{ className: NAV_LINK_ACTIVE, 'aria-current': 'page' }}
          >
            <NavIcon name="settings" />
            <span>Security</span>
          </Link>
          <ThemeToggle />
          <div className="truncate px-3 pt-1 text-xs text-text-muted">{user?.email}</div>
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

      <main id="main-content" className="flex-1 p-6 pt-16 md:p-8 md:pt-8">
        {/* Made available app-wide now; pages migrate onto `useDateRange` in a later phase. Scoped
            to a stable key even off project routes, so the provider never needs to unmount. */}
        <DateRangeProvider projectId={projectId ?? 'no-project'}>
          <Outlet />
        </DateRangeProvider>
      </main>
    </div>
  );
}

function NavSection({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      {heading && (
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted/80">
          {heading}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
