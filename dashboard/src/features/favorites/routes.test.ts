import { describe, expect, it } from 'vitest';
import { favItemRoute } from './routes';

const PROJECT_ID = 'proj-1';

describe('favItemRoute', () => {
  it('routes a report to its detail page', () => {
    expect(favItemRoute({ type: 'report', id: 'r1', name: 'Weekly checkouts' }, PROJECT_ID)).toEqual({
      to: '/projects/$projectId/reports/$reportId',
      params: { projectId: PROJECT_ID, reportId: 'r1' },
    });
  });

  it('routes a dashboard to its view page', () => {
    expect(favItemRoute({ type: 'dashboard', id: 'd1', name: 'Growth overview' }, PROJECT_ID)).toEqual({
      to: '/projects/$projectId/dashboards/$dashboardId',
      params: { projectId: PROJECT_ID, dashboardId: 'd1' },
    });
  });

  it('routes a user to their profile', () => {
    expect(favItemRoute({ type: 'user', id: 'user-001', name: 'user-001' }, PROJECT_ID)).toEqual({
      to: '/projects/$projectId/users/$distinctId',
      params: { projectId: PROJECT_ID, distinctId: 'user-001' },
    });
  });

  it('routes a cohort to the Cohorts list page (no standalone detail route)', () => {
    expect(favItemRoute({ type: 'cohort', id: 'c1', name: 'Recent buyers' }, PROJECT_ID)).toEqual({
      to: '/projects/$projectId/cohorts',
      params: { projectId: PROJECT_ID },
    });
  });
});
