import 'reflect-metadata';
import { PROJECT_ROLES_KEY } from '../../authz/project-roles.decorator';
import type { AuthRequest } from '../../auth/auth.types';
import { ProjectManagementService } from '../management/project-management.service';
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
      getProjectStats: jest.fn(),
    };
    const projectManagement = {
      createForOrg: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      purgeData: jest.fn(),
      listTokens: jest.fn(),
      createToken: jest.fn(),
      revokeToken: jest.fn(),
    };
    const controller = new ProjectsController(
      projects as unknown as ProjectsService,
      projectManagement as unknown as ProjectManagementService,
    );
    return { controller, projects, projectManagement };
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

  describe('stats', () => {
    it('wraps the per-project stats in a { stats } envelope, scoped to the caller', async () => {
      const { controller, projects } = makeController();
      const stats = [{ project_id: 'p1', user_count: 5, top_country: 'US' }];
      projects.getProjectStats.mockResolvedValue(stats);

      const body = await controller.stats(fakeRequest());

      expect(projects.getProjectStats).toHaveBeenCalledWith(USER.id);
      expect(body).toEqual({ stats });
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

  describe('update', () => {
    it('parses the body and delegates to ProjectManagementService', async () => {
      const { controller, projectManagement } = makeController();
      projectManagement.update.mockResolvedValue({ id: 'p1', name: 'New', timezone: 'UTC' });

      const body = await controller.update('p1', { name: 'New' });

      expect(projectManagement.update).toHaveBeenCalledWith('p1', { name: 'New' });
      expect(body).toEqual({ id: 'p1', name: 'New', timezone: 'UTC' });
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, projectManagement } = makeController();

      await expect(controller.update('p1', {})).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(projectManagement.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('delegates to ProjectManagementService', async () => {
      const { controller, projectManagement } = makeController();

      await controller.remove('p1');

      expect(projectManagement.remove).toHaveBeenCalledWith('p1');
    });
  });

  describe('purgeData', () => {
    it('is owner-gated', () => {
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, ProjectsController.prototype.purgeData)).toBe(
        'owner',
      );
    });

    it('parses the body and delegates the selected scopes to the service', async () => {
      const { controller, projectManagement } = makeController();
      const cleared = { cleared: { analytics: true, revenuecat: false, saved: true } };
      projectManagement.purgeData.mockResolvedValue(cleared);

      const body = await controller.purgeData('p1', {
        scopes: { analytics: true, saved: true },
      });

      expect(projectManagement.purgeData).toHaveBeenCalledWith('p1', {
        scopes: { analytics: true, saved: true },
      });
      expect(body).toEqual(cleared);
    });

    it('rejects a body that selects no scope before touching the service', async () => {
      const { controller, projectManagement } = makeController();

      await expect(controller.purgeData('p1', { scopes: {} })).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(projectManagement.purgeData).not.toHaveBeenCalled();
    });
  });

  describe('listTokens', () => {
    it('wraps the service result in a { tokens } envelope', async () => {
      const { controller, projectManagement } = makeController();
      const tokens = [{ id: 't1', token: 'mam_x', label: 'default', created_at: 'now' }];
      projectManagement.listTokens.mockResolvedValue(tokens);

      const body = await controller.listTokens('p1');

      expect(projectManagement.listTokens).toHaveBeenCalledWith('p1');
      expect(body).toEqual({ tokens });
    });
  });

  describe('createToken', () => {
    it('parses the optional label and delegates to ProjectManagementService', async () => {
      const { controller, projectManagement } = makeController();
      projectManagement.createToken.mockResolvedValue({ id: 't1', token: 'mam_x', label: 'ci' });

      const body = await controller.createToken('p1', { label: 'ci' });

      expect(projectManagement.createToken).toHaveBeenCalledWith('p1', 'ci');
      expect(body).toEqual({ id: 't1', token: 'mam_x', label: 'ci' });
    });

    it('works with no body at all (label optional)', async () => {
      const { controller, projectManagement } = makeController();
      projectManagement.createToken.mockResolvedValue({
        id: 't1',
        token: 'mam_x',
        label: 'default',
      });

      await controller.createToken('p1', {});

      expect(projectManagement.createToken).toHaveBeenCalledWith('p1', undefined);
    });
  });

  describe('revokeToken', () => {
    it('delegates to ProjectManagementService', async () => {
      const { controller, projectManagement } = makeController();

      await controller.revokeToken('p1', 't1');

      expect(projectManagement.revokeToken).toHaveBeenCalledWith('p1', 't1');
    });
  });
});
