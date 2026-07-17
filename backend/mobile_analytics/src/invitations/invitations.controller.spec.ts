import type { AuthRequest } from '../auth/auth.types';
import { InvitationsController } from './invitations.controller';
import type { InvitationsService } from './invitations.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, user: USER, ...overrides } as unknown as AuthRequest;
}

describe('InvitationsController (public token + accept)', () => {
  function makeController() {
    const invitations = { getByToken: jest.fn(), accept: jest.fn() };
    const controller = new InvitationsController(invitations as unknown as InvitationsService);
    return { controller, invitations };
  }

  describe('getByToken', () => {
    it('delegates to InvitationsService — no auth required', async () => {
      const { controller, invitations } = makeController();
      const publicInvite = {
        org_name: 'Acme',
        role: 'viewer',
        expires_at: '2026-07-11T00:00:00.000Z',
      };
      invitations.getByToken.mockResolvedValue(publicInvite);

      const body = await controller.getByToken('tok');

      expect(invitations.getByToken).toHaveBeenCalledWith('tok');
      expect(body).toEqual(publicInvite);
    });

    it('propagates a 410 thrown by the service (expired/accepted)', async () => {
      const { controller, invitations } = makeController();
      invitations.getByToken.mockRejectedValue(
        Object.assign(new Error('gone'), { problem: { status: 410 } }),
      );
      await expect(controller.getByToken('tok')).rejects.toMatchObject({
        problem: { status: 410 },
      });
    });
  });

  describe('accept', () => {
    it('delegates to InvitationsService with the caller id', async () => {
      const { controller, invitations } = makeController();
      invitations.accept.mockResolvedValue({ org_id: 'org-1', role: 'viewer' });

      const body = await controller.accept(fakeRequest(), 'tok');

      expect(invitations.accept).toHaveBeenCalledWith('tok', USER.id);
      expect(body).toEqual({ org_id: 'org-1', role: 'viewer' });
    });

    it('propagates a 410 thrown by the service', async () => {
      const { controller, invitations } = makeController();
      invitations.accept.mockRejectedValue(
        Object.assign(new Error('gone'), { problem: { status: 410 } }),
      );
      await expect(controller.accept(fakeRequest(), 'tok')).rejects.toMatchObject({
        problem: { status: 410 },
      });
    });
  });
});
