import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppLayout } from './components/layout/AppLayout';
import { NotFoundPage } from './components/NotFoundPage';
import { RouteErrorPage } from './components/RouteErrorPage';
import { AccountPage } from './features/auth/components/AccountPage';
import { InvitePage } from './features/auth/components/InvitePage';
import { LoginPage } from './features/auth/components/LoginPage';
import { SecuritySettingsPage } from './features/auth/components/SecuritySettingsPage';
import { SignupPage } from './features/auth/components/SignupPage';
import { authStore } from './features/auth/store';
import { HomePage } from './features/analytics/components/HomePage';
import { TemplatesPage } from './features/analytics/components/TemplatesPage';
import { InsightsPage } from './features/analytics/components/InsightsPage';
import { FunnelsPage } from './features/analytics/components/FunnelsPage';
import { RetentionPage } from './features/analytics/components/RetentionPage';
import { FlowsPage } from './features/analytics/components/FlowsPage';
import { PathsPage } from './features/analytics/components/PathsPage';
import { HeatmapPage } from './features/analytics/components/HeatmapPage';
import { CohortsPage } from './features/analytics/components/CohortsPage';
import { ReportsPage } from './features/analytics/components/ReportsPage';
import { ReportDetailPage } from './features/analytics/components/ReportDetailPage';
import { DashboardsPage } from './features/analytics/components/DashboardsPage';
import { DashboardViewPage } from './features/analytics/components/DashboardViewPage';
import { LiveEventsPage } from './features/analytics/components/LiveEventsPage';
import { SessionsPage } from './features/analytics/components/SessionsPage';
import { RevenuePage } from './features/analytics/components/RevenuePage';
import { UserProfilePage } from './features/analytics/components/UserProfilePage';
import { UsersPage } from './features/analytics/components/UsersPage';
import { OrgSettingsPage } from './features/orgs/components/OrgSettingsPage';
import { ProjectDetailPage } from './features/projects/components/ProjectDetailPage';
import { ProjectsPage } from './features/projects/components/ProjectsPage';
import { restoreSession } from './lib/api/client';
import { sanitizeRedirect } from './lib/safe-redirect';

/** Resolve the session exactly once per page load before any guarded navigation. */
async function ensureAuthResolved(): Promise<void> {
  if (authStore.getState().status === 'unknown') await restoreSession();
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // See sanitizeRedirect for the open-redirect guard this enforces. The
  // explicit `undefined` matters: matches inherit the RAW parent search, so
  // an omitted key would leak through.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
  beforeLoad: async () => {
    await ensureAuthResolved();
    if (authStore.getState().status === 'authenticated') throw redirect({ to: '/projects' });
  },
  component: LoginPage,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  // Same redirect guard as /login (invite-accept sends unauthenticated
  // visitors here too — contracts §13 invite flow).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
  beforeLoad: async () => {
    await ensureAuthResolved();
    if (authStore.getState().status === 'authenticated') throw redirect({ to: '/projects' });
  },
  component: SignupPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  // Public route, but must know whether the visitor is already signed in
  // (via the refresh cookie) to offer "Accept" vs. "log in / sign up first".
  beforeLoad: async () => {
    await ensureAuthResolved();
  },
  component: InvitePage,
});

const privateRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'private',
  beforeLoad: async ({ location }) => {
    await ensureAuthResolved();
    if (authStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

const projectsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects',
  component: ProjectsPage,
});

const projectDetailRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId',
  component: ProjectDetailPage,
});

// --- v2 home overview + templates gallery (contracts §19) ---

const homeRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/home',
  component: HomePage,
});

const templatesRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/templates',
  component: TemplatesPage,
});

// --- Core analytics, Phase 3 (contracts §14) — all scoped to the selected project ---

const insightsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/insights',
  // The shareable-analysis-URL `s` param (feat-01): a base64url-encoded builder state, decoded by
  // `useUrlAnalysisState` (see `features/analytics/share-state.ts`). Same explicit-`undefined`
  // pattern as `/login`'s `redirect` param, so an omitted `s` never leaks through from a parent match.
  validateSearch: (search: Record<string, unknown>): { s?: string } => ({
    s: typeof search.s === 'string' ? search.s : undefined,
  }),
  component: InsightsPage,
});

// --- Advanced analysis, Phase 4 (contracts §15) ---

// The shareable-analysis-URL `s` param (feat-01 §6 T2): same codec/hook as `/insights`, extended
// to the other builder pages. Same explicit-`undefined` pattern as `/login`'s `redirect` param, so
// an omitted `s` never leaks through from a parent match.
function validateShareSearch(search: Record<string, unknown>): { s?: string } {
  return { s: typeof search.s === 'string' ? search.s : undefined };
}

const funnelsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/funnels',
  validateSearch: validateShareSearch,
  component: FunnelsPage,
});

const retentionRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/retention',
  validateSearch: validateShareSearch,
  component: RetentionPage,
});

const flowsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/flows',
  validateSearch: validateShareSearch,
  component: FlowsPage,
});

// --- v2 flagship visuals (contracts §18/§19): user-path map + click heatmap ---

const pathsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/paths',
  validateSearch: validateShareSearch,
  component: PathsPage,
});

const heatmapRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/heatmap',
  component: HeatmapPage,
});

// --- Cohorts, saved reports & custom dashboards, Phase 5 (contracts §16) ---

const cohortsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/cohorts',
  component: CohortsPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/reports',
  component: ReportsPage,
});

const reportDetailRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/reports/$reportId',
  component: ReportDetailPage,
});

const dashboardsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/dashboards',
  component: DashboardsPage,
});

const dashboardViewRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/dashboards/$dashboardId',
  component: DashboardViewPage,
});

const liveEventsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/live',
  component: LiveEventsPage,
});

const usersRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/users',
  component: UsersPage,
});

const userProfileRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/users/$distinctId',
  component: UserProfilePage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/sessions',
  component: SessionsPage,
});

const revenueRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/revenue',
  component: RevenuePage,
});

const securitySettingsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/settings/security',
  component: SecuritySettingsPage,
});

const accountRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/account',
  component: AccountPage,
});

const orgSettingsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/orgs/$orgId/settings',
  component: OrgSettingsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  inviteRoute,
  privateRoute.addChildren([
    projectsRoute,
    projectDetailRoute,
    homeRoute,
    templatesRoute,
    insightsRoute,
    funnelsRoute,
    retentionRoute,
    flowsRoute,
    pathsRoute,
    heatmapRoute,
    cohortsRoute,
    reportsRoute,
    reportDetailRoute,
    dashboardsRoute,
    dashboardViewRoute,
    liveEventsRoute,
    usersRoute,
    userProfileRoute,
    sessionsRoute,
    revenueRoute,
    securitySettingsRoute,
    accountRoute,
    orgSettingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
