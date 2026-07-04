import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ProblemException } from '../common/problem-details';
import type { OrgRoleResolverService } from './org-role-resolver.service';
import { RolesGuard } from './roles.guard';

const USER_ID = 'user-1';

function ctxFor(params: Record<string, string>): ExecutionContext {
  const req = { user: { id: USER_ID }, params };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function makeGuard(required: string | undefined, resolved: { orgId: string; role: string }) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
    const resolver = { resolve: jest.fn().mockResolvedValue(resolved) };
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      resolver as unknown as OrgRoleResolverService,
    );
    return { guard, reflector, resolver };
  }

  it('allows the route through untouched when it has no @Roles metadata', async () => {
    const { guard, resolver } = makeGuard(undefined, { orgId: 'org-1', role: 'viewer' });
    await expect(guard.canActivate(ctxFor({ orgId: 'org-1' }))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('allows an admin caller on an admin-required route', async () => {
    const { guard } = makeGuard('admin', { orgId: 'org-1', role: 'admin' });
    await expect(guard.canActivate(ctxFor({ orgId: 'org-1' }))).resolves.toBe(true);
  });

  it('denies a viewer with 403 on an admin-required route', async () => {
    const { guard } = makeGuard('admin', { orgId: 'org-1', role: 'viewer' });
    await expect(guard.canActivate(ctxFor({ orgId: 'org-1' }))).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('denies an analyst with 403 on an admin-required route', async () => {
    const { guard } = makeGuard('admin', { orgId: 'org-1', role: 'analyst' });
    await expect(guard.canActivate(ctxFor({ orgId: 'org-1' }))).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('allows any membership role on a viewer-required route', async () => {
    const { guard } = makeGuard('viewer', { orgId: 'org-1', role: 'viewer' });
    await expect(guard.canActivate(ctxFor({ orgId: 'org-1' }))).resolves.toBe(true);
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
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      resolver as unknown as OrgRoleResolverService,
    );

    await expect(guard.canActivate(ctxFor({ orgId: 'org-1' }))).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('propagates a 404 for an unknown org/project (resolver-thrown, not role-related)', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('admin') };
    const resolver = {
      resolve: jest
        .fn()
        .mockRejectedValue(
          new ProblemException({ status: 404, title: 'Not Found', detail: 'unknown' }),
        ),
    };
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      resolver as unknown as OrgRoleResolverService,
    );

    await expect(guard.canActivate(ctxFor({ projectId: 'missing' }))).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('passes projectId (project->org resolution) through to the resolver untouched', async () => {
    const { guard, resolver } = makeGuard('admin', { orgId: 'org-1', role: 'admin' });
    await guard.canActivate(ctxFor({ projectId: 'project-1' }));
    expect(resolver.resolve).toHaveBeenCalledWith(USER_ID, {
      orgId: undefined,
      projectId: 'project-1',
      tokenId: undefined,
    });
  });

  it('passes tokenId through to the resolver when present', async () => {
    const { guard, resolver } = makeGuard('admin', { orgId: 'org-1', role: 'admin' });
    await guard.canActivate(ctxFor({ projectId: 'project-1', tokenId: 'token-1' }));
    expect(resolver.resolve).toHaveBeenCalledWith(USER_ID, {
      orgId: undefined,
      projectId: 'project-1',
      tokenId: 'token-1',
    });
  });
});
