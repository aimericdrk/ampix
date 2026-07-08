import type { FavItem } from './favorites';

/** A TanStack Router destination: a route path plus its params. */
export interface FavItemRoute {
  to: string;
  params: Record<string, string>;
}

/**
 * Maps a `FavItem` to its detail route, shared by Home's Favorites/Recents sections and the
 * command palette so both navigate identically. Cohorts have no standalone detail route (they're
 * edited inline on the list page, mirroring the palette's existing cohort entries) — this lands on
 * the Cohorts page rather than a dead link.
 */
export function favItemRoute(item: FavItem, projectId: string): FavItemRoute {
  switch (item.type) {
    case 'report':
      return { to: '/projects/$projectId/reports/$reportId', params: { projectId, reportId: item.id } };
    case 'dashboard':
      return {
        to: '/projects/$projectId/dashboards/$dashboardId',
        params: { projectId, dashboardId: item.id },
      };
    case 'user':
      return { to: '/projects/$projectId/users/$distinctId', params: { projectId, distinctId: item.id } };
    case 'cohort':
      return { to: '/projects/$projectId/cohorts', params: { projectId } };
  }
}
