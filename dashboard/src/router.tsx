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
