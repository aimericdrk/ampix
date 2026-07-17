import type { AuthRequest } from '../auth/auth.types';
import { ProblemException } from '../common/problem-details';
import type { ProjectRoleResolverService } from '../authz/project-role-resolver.service';
import { InternalAuthzController } from './internal-authz.controller';

const USER_ID = 'user-1';
const PROJECT_ID = 'project-1';

function reqFor(userId: string): AuthRequest {
  return { user: { id: userId, email: 'a@b.com', name: 'A' } } as AuthRequest;
}

function makeController(resolveProjectRole: jest.Mock) {
  const resolver = { resolveProjectRole } as unknown as ProjectRoleResolverService;
  return new InternalAuthzController(resolver);
}

/**
 * This controller is a thin wiring layer over ProjectRoleResolverService — the DB-level
 * mapping (membership lookup, org-owner derivation, non-member/unknown-project handling) is
 * already exhaustively covered by project-role-resolver.service.spec.ts against a mocked
 * PrismaService. These tests verify only what the controller itself adds: that it forwards
 * `req.user.id` + `:projectId` to the resolver, wraps the result as `{ role }`, and lets the
 * resolver's exceptions (403/404) propagate untouched to the caller — the internal-authz
 * contract other services rely on.
 */
describe('InternalAuthzController', () => {
  it('resolves and returns the caller role for a project', async () => {
    const resolveProjectRole = jest.fn().mockResolvedValue('analyst');
    const controller = makeController(resolveProjectRole);

    await expect(
      controller.resolveProjectRole(reqFor(USER_ID), PROJECT_ID),
    ).resolves.toEqual({ role: 'analyst' });
    expect(resolveProjectRole).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });

  it('returns owner for an org-owner-derived role (derivation itself is proven by ProjectRoleResolverService)', async () => {
    const resolveProjectRole = jest.fn().mockResolvedValue('owner');
    const controller = makeController(resolveProjectRole);

    await expect(
      controller.resolveProjectRole(reqFor(USER_ID), PROJECT_ID),
    ).resolves.toEqual({ role: 'owner' });
  });

  it('propagates a 403 for a non-member instead of swallowing it', async () => {
    const resolveProjectRole = jest
      .fn()
      .mockRejectedValue(
        new ProblemException({ status: 403, title: 'Forbidden', detail: 'not a member' }),
      );
    const controller = makeController(resolveProjectRole);

    await expect(
      controller.resolveProjectRole(reqFor(USER_ID), PROJECT_ID),
    ).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('propagates a 404 for an unknown project', async () => {
    const resolveProjectRole = jest
      .fn()
      .mockRejectedValue(new ProblemException({ status: 404, title: 'Not Found', detail: 'unknown' }));
    const controller = makeController(resolveProjectRole);

    await expect(
      controller.resolveProjectRole(reqFor(USER_ID), PROJECT_ID),
    ).rejects.toMatchObject({ problem: { status: 404 } });
  });
});
