import type { AuthRequest } from '../auth/auth.types';
import { ProjectsController } from './projects.controller';
import type { ProjectsService } from './projects.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, user: USER, ...overrides } as unknown as AuthRequest;
}

describe('ProjectsController', () => {
  function makeController() {
    const projects = {
      listForUser: jest.fn(),
      getEventsSummary: jest.fn(),
    };
    const controller = new ProjectsController(projects as unknown as ProjectsService);
    return { controller, projects };
  }

  describe('list', () => {
    it('wraps the service result in a { projects } envelope, scoped to the caller', async () => {
      const { controller, projects } = makeController();
      const items = [
        {
          id: 'p1',
          org_id: 'o1',
          org_name: 'Ada Workspace',
          name: 'Default',
          timezone: 'UTC',
          ingest_token: 'mam_' + 'a'.repeat(32),
        },
      ];
      projects.listForUser.mockResolvedValue(items);

      const body = await controller.list(fakeRequest());

      expect(projects.listForUser).toHaveBeenCalledWith(USER.id);
      expect(body).toEqual({ projects: items });
    });
  });

  describe('eventsSummary', () => {
    it('delegates to the service with the caller id and the path param project id', async () => {
      const { controller, projects } = makeController();
      const summary = {
        project_id: 'p1',
        total: 3,
        by_event: [{ event: 'checkout_completed', count: 3 }],
      };
      projects.getEventsSummary.mockResolvedValue(summary);

      const body = await controller.eventsSummary(fakeRequest(), 'p1');

      expect(projects.getEventsSummary).toHaveBeenCalledWith(USER.id, 'p1');
      expect(body).toEqual(summary);
    });

    it('propagates a ProblemException (403/404) thrown by the service', async () => {
      const { controller, projects } = makeController();
      projects.getEventsSummary.mockRejectedValue(
        Object.assign(new Error('forbidden'), { problem: { status: 403 } }),
      );

      await expect(controller.eventsSummary(fakeRequest(), 'p1')).rejects.toMatchObject({
        problem: { status: 403 },
      });
    });
  });
});
