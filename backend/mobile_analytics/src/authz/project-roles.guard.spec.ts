import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ProblemException } from '../common/problem-details';
import type { ProjectRoleResolverService } from './project-role-resolver.service';
import { ProjectRolesGuard } from './project-roles.guard';

const USER_ID = 'user-1';

function ctxFor(params: Record<string, string>): ExecutionContext {
  const req = { user: { id: USER_ID }, params };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('ProjectRolesGuard', () => {
  function makeGuard(required: string | undefined, resolved: { projectId: string; role: string }) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
    const resolver = { resolve: jest.fn().mockResolvedValue(resolved) };
    const guard = new ProjectRolesGuard(
      reflector as unknown as Reflector,
      resolver as unknown as ProjectRoleResolverService,
    );
    return { guard, reflector, resolver };
  }

  it('allows the route through untouched when it has no @ProjectRoles metadata', async () => {
    const { guard, resolver } = makeGuard(undefined, { projectId: 'project-1', role: 'viewer' });
    await expect(guard.canActivate(ctxFor({ projectId: 'project-1' }))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('allows an owner caller on an admin-required route', async () => {
    const { guard } = makeGuard('admin', { projectId: 'project-1', role: 'owner' });
    await expect(guard.canActivate(ctxFor({ projectId: 'project-1' }))).resolves.toBe(true);
  });

  it('denies a viewer with 403 on an admin-required route', async () => {
    const { guard } = makeGuard('admin', { projectId: 'project-1', role: 'viewer' });
    await expect(guard.canActivate(ctxFor({ projectId: 'project-1' }))).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('denies an analyst with 403 on an admin-required route', async () => {
    const { guard } = makeGuard('admin', { projectId: 'project-1', role: 'analyst' });
    await expect(guard.canActivate(ctxFor({ projectId: 'project-1' }))).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('allows any membership role on a viewer-required route', async () => {
    const { guard } = makeGuard('viewer', { projectId: 'project-1', role: 'viewer' });
    await expect(guard.canActivate(ctxFor({ projectId: 'project-1' }))).resolves.toBe(true);
  });

  it('propagates a 403 for a non-member (resolver throws before any role comparison)', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('admin') };
    const resolver = {
      resolve: jest
        .fn()
        .mockRejectedValue(
          new ProblemException({ status: 403, title: 'Forbidden', detail: 'not a member' }),
        ),
    };
    const guard = new ProjectRolesGuard(
      reflector as unknown as Reflector,
      resolver as unknown as ProjectRoleResolverService,
    );

    await expect(guard.canActivate(ctxFor({ projectId: 'project-1' }))).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('propagates a 404 for an unknown project (resolver-thrown, not role-related)', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('admin') };
    const resolver = {
      resolve: jest
        .fn()
        .mockRejectedValue(
          new ProblemException({ status: 404, title: 'Not Found', detail: 'unknown' }),
        ),
    };
    const guard = new ProjectRolesGuard(
      reflector as unknown as Reflector,
      resolver as unknown as ProjectRoleResolverService,
    );

    await expect(guard.canActivate(ctxFor({ projectId: 'missing' }))).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('passes tokenId through to the resolver when present', async () => {
    const { guard, resolver } = makeGuard('admin', { projectId: 'project-1', role: 'admin' });
    await guard.canActivate(ctxFor({ projectId: 'project-1', tokenId: 'token-1' }));
    expect(resolver.resolve).toHaveBeenCalledWith(USER_ID, {
      projectId: 'project-1',
      tokenId: 'token-1',
    });
  });
});
