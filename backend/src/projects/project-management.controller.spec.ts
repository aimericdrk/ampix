import type { AuthRequest } from '../auth/auth.types';
import { ProjectManagementController } from './project-management.controller';
import type { ProjectManagementService } from './project-management.service';

function makeRequest(userId = 'user-1'): AuthRequest {
  return { user: { id: userId, email: 'a@example.com', name: 'A' } } as unknown as AuthRequest;
}

describe('ProjectManagementController', () => {
  function makeController() {
    const projectManagement = { createForOrg: jest.fn() };
    const controller = new ProjectManagementController(
      projectManagement as unknown as ProjectManagementService,
    );
    return { controller, projectManagement };
  }

  describe('create', () => {
    it('parses the body and delegates to ProjectManagementService with the requester as creator', async () => {
      const { controller, projectManagement } = makeController();
      const created = {
        id: 'p1',
        org_id: 'org-1',
        name: 'New App',
        timezone: 'UTC',
        ingest_token: 'mam_' + 'a'.repeat(32),
      };
      projectManagement.createForOrg.mockResolvedValue(created);

      const body = await controller.create('org-1', { name: 'New App' }, makeRequest('user-1'));

      expect(projectManagement.createForOrg).toHaveBeenCalledWith(
        'org-1',
        'New App',
        'user-1',
        undefined,
      );
      expect(body).toEqual(created);
    });

    it('passes an explicit timezone through', async () => {
      const { controller, projectManagement } = makeController();
      projectManagement.createForOrg.mockResolvedValue({});

      await controller.create(
        'org-1',
        { name: 'New App', timezone: 'Europe/Paris' },
        makeRequest('user-1'),
      );

      expect(projectManagement.createForOrg).toHaveBeenCalledWith(
        'org-1',
        'New App',
        'user-1',
        'Europe/Paris',
      );
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, projectManagement } = makeController();
      await expect(controller.create('org-1', {}, makeRequest())).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(projectManagement.createForOrg).not.toHaveBeenCalled();
    });
  });
});
