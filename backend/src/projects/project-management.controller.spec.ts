import { ProjectManagementController } from './project-management.controller';
import type { ProjectManagementService } from './project-management.service';

describe('ProjectManagementController', () => {
  function makeController() {
    const projectManagement = { createForOrg: jest.fn() };
    const controller = new ProjectManagementController(
      projectManagement as unknown as ProjectManagementService,
    );
    return { controller, projectManagement };
  }

  describe('create', () => {
    it('parses the body and delegates to ProjectManagementService', async () => {
      const { controller, projectManagement } = makeController();
      const created = {
        id: 'p1',
        org_id: 'org-1',
        name: 'New App',
        timezone: 'UTC',
        ingest_token: 'mam_' + 'a'.repeat(32),
      };
      projectManagement.createForOrg.mockResolvedValue(created);

      const body = await controller.create('org-1', { name: 'New App' });

      expect(projectManagement.createForOrg).toHaveBeenCalledWith('org-1', 'New App', undefined);
      expect(body).toEqual(created);
    });

    it('passes an explicit timezone through', async () => {
      const { controller, projectManagement } = makeController();
      projectManagement.createForOrg.mockResolvedValue({});

      await controller.create('org-1', { name: 'New App', timezone: 'Europe/Paris' });

      expect(projectManagement.createForOrg).toHaveBeenCalledWith(
        'org-1',
        'New App',
        'Europe/Paris',
      );
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, projectManagement } = makeController();
      await expect(controller.create('org-1', {})).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(projectManagement.createForOrg).not.toHaveBeenCalled();
    });
  });
});
