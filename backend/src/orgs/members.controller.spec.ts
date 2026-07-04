import { MembersController } from './members.controller';
import type { MembersService } from './members.service';

describe('MembersController', () => {
  function makeController() {
    const members = {
      list: jest.fn(),
      changeRole: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new MembersController(members as unknown as MembersService);
    return { controller, members };
  }

  describe('list', () => {
    it('wraps the service result in a { members } envelope', async () => {
      const { controller, members } = makeController();
      const items = [{ user: { id: 'u1', email: 'a@b.com', name: 'A' }, role: 'admin' }];
      members.list.mockResolvedValue(items);

      const body = await controller.list('org-1');

      expect(members.list).toHaveBeenCalledWith('org-1');
      expect(body).toEqual({ members: items });
    });
  });

  describe('changeRole', () => {
    it('parses the body and delegates to MembersService', async () => {
      const { controller, members } = makeController();
      members.changeRole.mockResolvedValue({ user_id: 'u1', role: 'analyst' });

      const body = await controller.changeRole('org-1', 'u1', { role: 'analyst' });

      expect(members.changeRole).toHaveBeenCalledWith('org-1', 'u1', 'analyst');
      expect(body).toEqual({ user_id: 'u1', role: 'analyst' });
    });

    it('rejects an invalid role before touching the service', async () => {
      const { controller, members } = makeController();
      await expect(
        controller.changeRole('org-1', 'u1', { role: 'superadmin' }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(members.changeRole).not.toHaveBeenCalled();
    });

    it('propagates a 409 thrown by the service (last-admin protection)', async () => {
      const { controller, members } = makeController();
      members.changeRole.mockRejectedValue(
        Object.assign(new Error('conflict'), { problem: { status: 409 } }),
      );
      await expect(controller.changeRole('org-1', 'u1', { role: 'viewer' })).rejects.toMatchObject({
        problem: { status: 409 },
      });
    });
  });

  describe('remove', () => {
    it('delegates to MembersService', async () => {
      const { controller, members } = makeController();
      await controller.remove('org-1', 'u1');
      expect(members.remove).toHaveBeenCalledWith('org-1', 'u1');
    });

    it('propagates a 409 thrown by the service (last-admin protection)', async () => {
      const { controller, members } = makeController();
      members.remove.mockRejectedValue(
        Object.assign(new Error('conflict'), { problem: { status: 409 } }),
      );
      await expect(controller.remove('org-1', 'u1')).rejects.toMatchObject({
        problem: { status: 409 },
      });
    });
  });
});
