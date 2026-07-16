import { Link, Outlet, useNavigate, useParams, useRouter, useRouterState } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DateRangeProvider } from '../../features/analytics/date-range';
import { GlobalFilterBar } from '../../features/analytics/components/GlobalFilterBar';
import { GlobalFiltersProvider } from '../../features/analytics/global-filters';
import { CommandPalette } from '../../features/command-palette/CommandPalette';
import { logout } from '../../features/auth/api';
import { authStore, useAuth } from '../../features/auth/store';
import { currentOrgStore, useCurrentOrgId } from '../../features/orgs/store';
import { useProjects } from '../../features/projects/api';
import { useRcEnabled } from '../../features/revenuecat/api';
import { useKeyboardShortcuts } from '../../features/shortcuts/keyboard-shortcuts';
import { ShortcutsHelp } from '../../features/shortcuts/ShortcutsHelp';
import { cn } from '../../lib/cn';
import { springTransition, useReducedMotion } from '../../lib/motion';
import { Button } from '../ui/button';
import { Kbd } from '../ui/kbd';
import { toolForPathname, toolGroups, type NavAccent, type NavItem } from './nav-model';
import { NavIcon, type IconName } from './NavIcon';
import { OrgSwitcher } from './OrgSwitcher';
import { ProjectSwitcher } from './ProjectSwitcher';
import { RailIdentityMenu } from './RailIdentityMenu';
import { ThemeToggle } from './ThemeToggle';
import { ToolRail } from './ToolRail';

const NAV_LINK_BASE =
  'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text';
const NAV_LINK_ACTIVE = 'bg-accent-soft text-accent font-medium';
const NAV_INDICATOR_CLASS = 'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent';

/** Resolve a route pattern (e.g. `/projects/$projectId/insights`) against real param values, so it can
 * be compared with the router's current pathname — the same substitution `Link` does internally. */
function resolveHref(to: string, params?: Record<string, string | undefined>): string {
  if (!params) return to;
  return Object.entries(params).reduce(
    (href, [key, value]) => (value ? href.replaceAll(`$${key}`, value) : href),
    to,
  );
}

/** Mirrors `activeOptions.exact` semantics: exact requires an identical pathname, otherwise the
 * current route matching `href` or one of its descendants counts as active. */
function isHrefActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sliding accent indicator — a shared `layoutId` so it glides between whichever sidebar link is
 * active, instead of popping. Renders as a plain bar (no layout animation) under reduced motion.
 * The `layoutId` is a parameter so links in different columns can opt into separate layout groups:
 * the section nav shares one id (the bar slides between sections), while the lone global "Projects"
 * link uses its own, so its indicator never flies diagonally across to the section-nav column. */
function NavIndicator({ layoutId = 'nav-indicator' }: { layoutId?: string }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return <span className={NAV_INDICATOR_CLASS} />;
  return <m.span layoutId={layoutId} className={NAV_INDICATOR_CLASS} transition={springTransition} />;
}

function SidebarLink({
  to,
  params,
  exact = false,
  icon,
  label,
  indicatorId,
}: {
  to: string;
  params?: Record<string, string | undefined>;
  exact?: boolean;
  icon: IconName;
  label: string;
  /** Layout-group id for the active indicator; omit to share the section nav's sliding bar. */
  indicatorId?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isHrefActive(pathname, resolveHref(to, params), exact);

  return (
    <Link
      to={to}
      params={params}
      // Mirror `isHrefActive`'s own exact/non-exact semantics onto TanStack's matching, instead
      // of leaving it on the library default (non-exact prefix match). `Link` computes its own
      // `aria-current` and, because it's spread in after our own props, the two are unioned, not
      // overridden — TanStack's value only ever ADDS `page`, never removes it. So without this,
      // an ancestor link (e.g. "Projects", "Project settings") would get `aria-current="page"`
      // added on every descendant route, even though it's `exact: true` and not tinted.
      activeOptions={{ exact }}
      className={cn(NAV_LINK_BASE, active && NAV_LINK_ACTIVE)}
      aria-current={active ? 'page' : undefined}
    >
      {active && <NavIndicator layoutId={indicatorId} />}
      <NavIcon name={icon} />
      <span>{label}</span>
    </Link>
  );
}

function NavLink({ item, projectId }: { item: NavItem; projectId?: string }) {
  return (
    <SidebarLink
      to={item.to}
      params={projectId ? { projectId } : undefined}
      exact={item.exact ?? false}
      icon={item.icon}
      label={item.label}
    />
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
  const [helpOpen, setHelpOpen] = useState(false);

  // Global `g <letter>` navigation + `?` help overlay (feat-12). Disabled while the overlay
  // itself is open so a stray keypress behind it can't fire a surprise navigation.
  useKeyboardShortcuts({
    projectId,
    onShowHelp: () => setHelpOpen(true),
    disabled: helpOpen,
  });

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

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rcEnabled = useRcEnabled(projectId);
  const activeTool = toolForPathname(pathname);
  const groups = useMemo(
    () => (projectId ? toolGroups(activeTool, { rcEnabled }) : []),
    [projectId, activeTool, rcEnabled],
  );
  const activeGroupAccent: NavAccent =
    groups.find((group) =>
      group.items.some((item) =>
        isHrefActive(
          pathname,
          resolveHref(item.to, projectId ? { projectId } : undefined),
          item.exact ?? false,
        ),
      ),
    )?.accent ?? 'violet';

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
        <span className="font-display text-lg font-bold text-gradient-brand">MyAmpix</span>
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

      {/* Below `md` the rail and section list stack inside one drawer and share a single scroll
          container; from `md` up they sit side by side, and the section list's own nav scrolls
          independently within a sticky, viewport-height column (unchanged from before this task). */}
      <div
        id="app-sidebar"
        className={cn(
          'z-40 flex flex-col shrink-0 overflow-y-auto',
          'md:sticky md:top-0 md:h-screen md:flex-row md:overflow-visible',
          mobileOpen ? 'fixed inset-y-0 left-0 flex' : 'hidden md:flex',
        )}
      >
        {/* Global sidebar: brand, tool switcher, and the project-scoped chrome (workspace, project,
            search, Projects) all live on the left, so everything global sits in one column. The
            aside beside it holds only the active tool's section nav. Full-width when stacked below
            `md`; a fixed 240px column beside the aside from `md` up, scrolling on its own if tall. */}
        <div
          data-testid="global-sidebar"
          className="flex w-full shrink-0 flex-col gap-3 border-r border-border bg-surface p-4 md:w-60 md:overflow-y-auto"
        >
          <span className="font-display text-lg font-bold text-gradient-brand">MyAmpix</span>
          <OrgSwitcher />
          <ProjectSwitcher />
          {/* Project-scoped: reports/dashboards/cohorts/users only resolve once a project is picked. */}
          {projectId && <CommandPalette projectId={projectId} />}
          {/* Its own indicator layout group so the active bar never animates across to the section
              nav in the other column. */}
          <SidebarLink
            to="/projects"
            exact
            icon="projects"
            label="Projects"
            indicatorId="global-nav-indicator"
          />
          {/* Tool switcher sits below the Projects link, above the identity cluster. */}
          <ToolRail activeTool={activeTool} projectId={projectId} />
          <div className="mt-auto flex flex-col gap-1 pt-2">
            <ThemeToggle />
            <RailIdentityMenu email={user?.email} orgId={currentOrgId} onLogout={() => void handleLogout()} />
          </div>
        </div>

        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
          <nav
            aria-label="Primary"
            className="min-h-0 flex-1 overflow-y-auto p-4"
            onClickCapture={() => setMobileOpen(false)}
          >
            {groups.map((group, index) => (
              <NavSection
                key={group.heading ?? `group-${index}`}
                heading={group.heading}
                accent={group.accent}
              >
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

          <div className="mt-auto shrink-0 border-t border-border p-4">
            {/* Subtle, always-available affordance for the shortcut system (feat-12). */}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="w-full truncate px-3 text-left text-xs text-text-muted/70 transition-colors hover:text-text-muted"
            >
              Press <Kbd>?</Kbd> for shortcuts
            </button>
          </div>
        </aside>
      </div>

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      <main
        id="main-content"
        data-accent={activeGroupAccent}
        className="flex min-h-screen flex-1 flex-col p-6 pt-16 md:p-8 md:pt-8"
      >
        {/* Made available app-wide now; pages migrate onto `useDateRange` in a later phase. Scoped
            to a stable key even off project routes, so the provider never needs to unmount. */}
        <DateRangeProvider projectId={projectId ?? 'no-project'}>
          {/* Global Filters Bar (feat-02): scoped the same way as the date range, so switching
              projects loads that project's saved filters instead of leaking the previous one's. */}
          <GlobalFiltersProvider projectId={projectId ?? 'no-project'}>
            {projectId && <GlobalFilterBar projectId={projectId} />}
            <div className="flex-1">
              <Outlet />
            </div>
          </GlobalFiltersProvider>
        </DateRangeProvider>
      </main>
    </div>
  );
}

function NavSection({
  heading,
  accent,
  children,
}: {
  heading?: string;
  accent?: NavAccent;
  children: ReactNode;
}) {
  return (
    <div className="mt-4" data-accent={accent}>
      {heading && (
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted/70">
          {heading}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
