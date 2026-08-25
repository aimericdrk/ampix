import { Reflector } from '@nestjs/core';
import type { AuthRequest } from '../../auth/auth.types';
import { ROLES_KEY } from '../../authz/roles.decorator';
import { RolesGuard } from '../../authz/roles.guard';
import { OrgsController } from './orgs.controller';
import type { OrgsService } from './orgs.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, user: USER, ...overrides } as unknown as AuthRequest;
}

describe('OrgsController', () => {
  function makeController() {
    const orgs = {
      create: jest.fn(),
      listForUser: jest.fn(),
      rename: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new OrgsController(orgs as unknown as OrgsService);
    return { controller, orgs };
  }

  describe('create', () => {
    it('parses the body and delegates to OrgsService with the caller id', async () => {
      const { controller, orgs } = makeController();
      orgs.create.mockResolvedValue({ id: 'org-1', name: 'Acme', role: 'admin' });

      const body = await controller.create(fakeRequest(), { name: 'Acme' });

      expect(orgs.create).toHaveBeenCalledWith(USER.id, 'Acme');
      expect(body).toEqual({ id: 'org-1', name: 'Acme', role: 'admin' });
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, orgs } = makeController();
      await expect(controller.create(fakeRequest(), {})).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(orgs.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('wraps the service result in a { orgs } envelope, scoped to the caller', async () => {
      const { controller, orgs } = makeController();
      const items = [{ id: 'org-1', name: 'Acme', role: 'admin' }];
      orgs.listForUser.mockResolvedValue(items);

      const body = await controller.list(fakeRequest());

      expect(orgs.listForUser).toHaveBeenCalledWith(USER.id);
      expect(body).toEqual({ orgs: items });
    });
  });

  describe('rename', () => {
    it('parses the body and delegates to OrgsService', async () => {
      const { controller, orgs } = makeController();
      orgs.rename.mockResolvedValue({ id: 'org-1', name: 'New Name' });

      const body = await controller.rename('org-1', { name: 'New Name' });

      expect(orgs.rename).toHaveBeenCalledWith('org-1', 'New Name');
      expect(body).toEqual({ id: 'org-1', name: 'New Name' });
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, orgs } = makeController();
      await expect(controller.rename('org-1', { name: '' })).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(orgs.rename).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('delegates to OrgsService with the caller id and resolves with no body (204)', async () => {
      const { controller, orgs } = makeController();
      orgs.remove.mockResolvedValue(undefined);

      await expect(controller.remove(fakeRequest(), 'org-1')).resolves.toBeUndefined();

      // The actor is threaded through purely so the deletion is attributable in the logs.
      expect(orgs.remove).toHaveBeenCalledWith('org-1', USER.id);
    });
  });

  /**
   * The delete gate is declarative (`@Roles('owner')` + `@UseGuards(RolesGuard)`), so nothing in
   * the handler body would fail if someone relaxed it to 'admin' or dropped the guard — the
   * controller unit tests above would all still pass. These assert the metadata itself, so a
   * silent privilege downgrade breaks the build instead of shipping.
   */
  describe('route authorization metadata', () => {
    const reflector = new Reflector();

    it('gates remove() on the owner role, one rank above rename()', () => {
      expect(reflector.get(ROLES_KEY, OrgsController.prototype.remove)).toBe('owner');
      expect(reflector.get(ROLES_KEY, OrgsController.prototype.rename)).toBe('admin');
    });

    it('attaches RolesGuard to remove() — the metadata is inert without it', () => {
      const guards: unknown[] =
        Reflect.getMetadata('__guards__', OrgsController.prototype.remove) ?? [];
      expect(guards).toContain(RolesGuard);
    });

    it('leaves create() and list() ungated (any authenticated user)', () => {
      expect(reflector.get(ROLES_KEY, OrgsController.prototype.create)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, OrgsController.prototype.list)).toBeUndefined();
    });
  });
});
