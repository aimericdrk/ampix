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
import { InvitePage } from './features/auth/components/InvitePage';
import { LoginPage } from './features/auth/components/LoginPage';
import { SecuritySettingsPage } from './features/auth/components/SecuritySettingsPage';
import { SignupPage } from './features/auth/components/SignupPage';
import { authStore } from './features/auth/store';
import { ProjectDetailPage } from './features/projects/components/ProjectDetailPage';
import { ProjectsPage } from './features/projects/components/ProjectsPage';
import { restoreSession } from './lib/api/client';

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
  // Single enforcement point for the post-login redirect (open-redirect
  // guard): only same-app absolute paths pass — must start with '/' but not
  // '//' (protocol-relative URL), and must not contain '\\' (browsers treat
  // backslashes as slashes when resolving URLs, so '/\\evil.com' would be a
  // protocol-relative bypass). Anything else is dropped so LoginForm falls
  // back to /projects. The explicit `undefined` matters: matches inherit
  // the RAW parent search, so an omitted key would leak through.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect:
      typeof search.redirect === 'string' &&
      search.redirect.startsWith('/') &&
      !search.redirect.startsWith('//') &&
      !search.redirect.includes('\\')
        ? search.redirect
        : undefined,
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
  beforeLoad: async () => {
    await ensureAuthResolved();
    if (authStore.getState().status === 'authenticated') throw redirect({ to: '/projects' });
  },
  component: SignupPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
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

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  inviteRoute,
  privateRoute.addChildren([projectsRoute, projectDetailRoute, securitySettingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
