import { OrgInvitationsController } from './org-invitations.controller';
import type { InvitationsService } from './invitations.service';

describe('OrgInvitationsController', () => {
  function makeController() {
    const invitations = {
      create: jest.fn(),
      listPending: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new OrgInvitationsController(invitations as unknown as InvitationsService);
    return { controller, invitations };
  }

  describe('create', () => {
    it('parses the body and delegates to InvitationsService', async () => {
      const { controller, invitations } = makeController();
      const created = {
        id: 'inv-1',
        role: 'viewer',
        token: 'tok',
        invite_path: '/invite/tok',
        expires_at: '2026-07-11T00:00:00.000Z',
      };
      invitations.create.mockResolvedValue(created);

      const body = await controller.create('org-1', { role: 'viewer' });

      expect(invitations.create).toHaveBeenCalledWith('org-1', 'viewer');
      expect(body).toEqual(created);
    });

    it('rejects an invalid role before touching the service', async () => {
      const { controller, invitations } = makeController();
      await expect(controller.create('org-1', { role: 'owner' })).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(invitations.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('wraps the service result in an { invitations } envelope', async () => {
      const { controller, invitations } = makeController();
      const items = [{ id: 'inv-1', role: 'viewer', expires_at: '2026-07-11T00:00:00.000Z' }];
      invitations.listPending.mockResolvedValue(items);

      const body = await controller.list('org-1');

      expect(invitations.listPending).toHaveBeenCalledWith('org-1');
      expect(body).toEqual({ invitations: items });
    });
  });

  describe('remove', () => {
    it('delegates to InvitationsService', async () => {
      const { controller, invitations } = makeController();
      await controller.remove('org-1', 'inv-1');
      expect(invitations.remove).toHaveBeenCalledWith('org-1', 'inv-1');
    });

    it('propagates a 404 thrown by the service (cross-org scoping)', async () => {
      const { controller, invitations } = makeController();
      invitations.remove.mockRejectedValue(
        Object.assign(new Error('not found'), { problem: { status: 404 } }),
      );
      await expect(controller.remove('org-1', 'inv-1')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });
  });
});
