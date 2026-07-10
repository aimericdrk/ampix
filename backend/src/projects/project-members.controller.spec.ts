import 'reflect-metadata';
import { PROJECT_ROLES_KEY } from '../authz/project-roles.decorator';
import { ProjectMembersController } from './project-members.controller';
import type { ProjectMembersService } from './project-members.service';
import type { ProjectRoleResolverService } from '../authz/project-role-resolver.service';

describe('ProjectMembersController', () => {
  function makeController() {
    const members = {
      list: jest.fn(),
      add: jest.fn(),
      changeRole: jest.fn(),
      remove: jest.fn(),
    };
    const resolver = {
      resolveProjectRole: jest.fn(),
    };
    const controller = new ProjectMembersController(
      members as unknown as ProjectMembersService,
      resolver as unknown as ProjectRoleResolverService,
    );
    return { controller, members, resolver };
  }

  describe('route guard metadata', () => {
    it('requires at least viewer to list members', () => {
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, ProjectMembersController.prototype.list)).toBe('viewer');
    });

    it('requires admin to add a member', () => {
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, ProjectMembersController.prototype.add)).toBe('admin');
    });

    it('requires admin to change a member role', () => {
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, ProjectMembersController.prototype.changeRole)).toBe('admin');
    });

    it('requires admin to remove a member', () => {
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, ProjectMembersController.prototype.remove)).toBe('admin');
    });
  });

  describe('list', () => {
    it('wraps the service result in a { members } envelope', async () => {
      const { controller, members } = makeController();
      const items = [{ user: { id: 'u1', email: 'a@b.com', name: 'A' }, role: 'admin' }];
      members.list.mockResolvedValue(items);

      const body = await controller.list('project-1');

      expect(members.list).toHaveBeenCalledWith('project-1');
      expect(body).toEqual({ members: items });
    });
  });

  const TARGET_USER_ID = '11111111-1111-1111-1111-111111111111';

  describe('add', () => {
    it('resolves the actor role, parses the body, and delegates to ProjectMembersService', async () => {
      const { controller, members, resolver } = makeController();
      resolver.resolveProjectRole.mockResolvedValue('admin');
      members.add.mockResolvedValue({ user_id: TARGET_USER_ID, role: 'analyst' });
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      const body = await controller.add(req as any, 'project-1', { userId: TARGET_USER_ID, role: 'analyst' });

      expect(resolver.resolveProjectRole).toHaveBeenCalledWith('actor-1', 'project-1');
      expect(members.add).toHaveBeenCalledWith('project-1', 'admin', TARGET_USER_ID, 'analyst');
      expect(body).toEqual({ user_id: TARGET_USER_ID, role: 'analyst' });
    });

    it('rejects an invalid body before touching the resolver or the service', async () => {
      const { controller, members, resolver } = makeController();
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      await expect(
        controller.add(req as any, 'project-1', { userId: TARGET_USER_ID, role: 'superadmin' }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(resolver.resolveProjectRole).not.toHaveBeenCalled();
      expect(members.add).not.toHaveBeenCalled();
    });

    it('propagates a 409 thrown by the service', async () => {
      const { controller, members, resolver } = makeController();
      resolver.resolveProjectRole.mockResolvedValue('admin');
      members.add.mockRejectedValue(Object.assign(new Error('conflict'), { problem: { status: 409 } }));
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      await expect(
        controller.add(req as any, 'project-1', { userId: TARGET_USER_ID, role: 'analyst' }),
      ).rejects.toMatchObject({ problem: { status: 409 } });
    });
  });

  describe('changeRole', () => {
    it('resolves the actor role, parses the body, and delegates to ProjectMembersService', async () => {
      const { controller, members, resolver } = makeController();
      resolver.resolveProjectRole.mockResolvedValue('owner');
      members.changeRole.mockResolvedValue({ user_id: 'u2', role: 'analyst' });
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      const body = await controller.changeRole(req as any, 'project-1', 'u2', { role: 'analyst' });

      expect(resolver.resolveProjectRole).toHaveBeenCalledWith('actor-1', 'project-1');
      expect(members.changeRole).toHaveBeenCalledWith('project-1', 'owner', 'u2', 'analyst');
      expect(body).toEqual({ user_id: 'u2', role: 'analyst' });
    });

    it('rejects an invalid role before touching the resolver or the service', async () => {
      const { controller, members, resolver } = makeController();
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      await expect(
        controller.changeRole(req as any, 'project-1', 'u2', { role: 'superadmin' }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(resolver.resolveProjectRole).not.toHaveBeenCalled();
      expect(members.changeRole).not.toHaveBeenCalled();
    });

    it('propagates a 409 thrown by the service (last-owner protection)', async () => {
      const { controller, members, resolver } = makeController();
      resolver.resolveProjectRole.mockResolvedValue('owner');
      members.changeRole.mockRejectedValue(Object.assign(new Error('conflict'), { problem: { status: 409 } }));
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      await expect(
        controller.changeRole(req as any, 'project-1', 'u2', { role: 'viewer' }),
      ).rejects.toMatchObject({ problem: { status: 409 } });
    });
  });

  describe('remove', () => {
    it('resolves the actor role and delegates to ProjectMembersService', async () => {
      const { controller, members, resolver } = makeController();
      resolver.resolveProjectRole.mockResolvedValue('admin');
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      await controller.remove(req as any, 'project-1', 'u2');

      expect(resolver.resolveProjectRole).toHaveBeenCalledWith('actor-1', 'project-1');
      expect(members.remove).toHaveBeenCalledWith('project-1', 'admin', 'u2');
    });

    it('propagates a 409 thrown by the service (last-owner protection)', async () => {
      const { controller, members, resolver } = makeController();
      resolver.resolveProjectRole.mockResolvedValue('owner');
      members.remove.mockRejectedValue(Object.assign(new Error('conflict'), { problem: { status: 409 } }));
      const req = { user: { id: 'actor-1', email: 'x@y.com', name: 'X' } };

      await expect(controller.remove(req as any, 'project-1', 'u2')).rejects.toMatchObject({
        problem: { status: 409 },
      });
    });
  });
});
