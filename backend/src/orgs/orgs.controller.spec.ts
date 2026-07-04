import type { AuthRequest } from '../auth/auth.types';
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
});
