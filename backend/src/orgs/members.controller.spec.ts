import { MembersController } from './members.controller';
import type { MembersService } from './members.service';
import type { AuthRequest } from '../auth/auth.types';

const ACTOR_ID = 'actor-1';

describe('MembersController', () => {
  function makeController() {
    const members = {
      list: jest.fn(),
      changeRole: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new MembersController(members as unknown as MembersService);
    const req = { user: { id: ACTOR_ID, email: 'actor@acme.test', name: 'Actor' } } as AuthRequest;
    return { controller, members, req };
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
    it('parses the body and delegates to MembersService with the caller as actor', async () => {
      const { controller, members, req } = makeController();
      members.changeRole.mockResolvedValue({ user_id: 'u1', role: 'analyst' });

      const body = await controller.changeRole(req, 'org-1', 'u1', { role: 'analyst' });

      expect(members.changeRole).toHaveBeenCalledWith('org-1', ACTOR_ID, 'u1', 'analyst');
      expect(body).toEqual({ user_id: 'u1', role: 'analyst' });
    });

    it('accepts an owner role in the body (ownership transfer)', async () => {
      const { controller, members, req } = makeController();
      members.changeRole.mockResolvedValue({ user_id: 'u1', role: 'owner' });

      const body = await controller.changeRole(req, 'org-1', 'u1', { role: 'owner' });

      expect(members.changeRole).toHaveBeenCalledWith('org-1', ACTOR_ID, 'u1', 'owner');
      expect(body).toEqual({ user_id: 'u1', role: 'owner' });
    });

    it('rejects an invalid role before touching the service', async () => {
      const { controller, members, req } = makeController();
      await expect(
        controller.changeRole(req, 'org-1', 'u1', { role: 'superadmin' }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(members.changeRole).not.toHaveBeenCalled();
    });

    it('propagates a 409 thrown by the service (owner protection)', async () => {
      const { controller, members, req } = makeController();
      members.changeRole.mockRejectedValue(
        Object.assign(new Error('conflict'), { problem: { status: 409 } }),
      );
      await expect(
        controller.changeRole(req, 'org-1', 'u1', { role: 'viewer' }),
      ).rejects.toMatchObject({
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

    it('propagates a 409 thrown by the service (owner protection)', async () => {
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
