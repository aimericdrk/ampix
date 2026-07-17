import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ProblemException } from '../common/problem-details';
import type { ProjectAccessService } from './project-access.service';
import { ProjectAccessGuard } from './project-access.guard';

const PROJECT_ID = 'project-1';

function ctxFor(params: Record<string, string>, headers: Record<string, string> = {}): ExecutionContext {
  const req = { params, headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function makeGuard(required: string | undefined, role: string | null) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
  const projectAccess = { getProjectRole: jest.fn().mockResolvedValue(role) };
  const guard = new ProjectAccessGuard(
    reflector as unknown as Reflector,
    projectAccess as unknown as ProjectAccessService,
  );
  return { guard, reflector, projectAccess };
}

describe('ProjectAccessGuard', () => {
  it('default-denies (403) an undecorated handler under @UseGuards(ProjectAccessGuard) with no @RequireProjectRole metadata', async () => {
    const { guard, projectAccess } = makeGuard(undefined, 'admin');
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).rejects.toMatchObject({ problem: { status: 403 } });
    expect(projectAccess.getProjectRole).not.toHaveBeenCalled();
  });

  it('allows an admin caller on an admin-required route', async () => {
    const { guard } = makeGuard('admin', 'admin');
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).resolves.toBe(true);
  });

  it('allows an owner caller (higher rank) on an admin-required route', async () => {
    const { guard } = makeGuard('admin', 'owner');
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).resolves.toBe(true);
  });

  it('denies a viewer with 403 on an admin-required route', async () => {
    const { guard } = makeGuard('admin', 'viewer');
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('denies with 403 when ProjectAccessService resolves null (analytics denied the request with 403/404)', async () => {
    const { guard } = makeGuard('admin', null);
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('denies with 403 when the resolved role is not a recognized ProjectRole (fail-closed defense in depth)', async () => {
    const { guard } = makeGuard('admin', 'guest');
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('propagates a 401 thrown by ProjectAccessService (analytics rejected the credentials)', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('admin') };
    const projectAccess = {
      getProjectRole: jest
        .fn()
        .mockRejectedValue(
          new ProblemException({ status: 401, title: 'Unauthorized', detail: 'analytics rejected credentials' }),
        ),
    };
    const guard = new ProjectAccessGuard(
      reflector as unknown as Reflector,
      projectAccess as unknown as ProjectAccessService,
    );

    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer t' })),
    ).rejects.toMatchObject({ problem: { status: 401 } });
  });

  it('denies with 401 (not 403) when the Authorization header is missing — checked before calling the service', async () => {
    const { guard, projectAccess } = makeGuard('admin', 'admin');
    await expect(
      guard.canActivate(ctxFor({ projectId: PROJECT_ID }, {})),
    ).rejects.toMatchObject({ problem: { status: 401 } });
    expect(projectAccess.getProjectRole).not.toHaveBeenCalled();
  });

  it('passes projectId + the raw Authorization header through to the service', async () => {
    const { guard, projectAccess } = makeGuard('admin', 'admin');
    await guard.canActivate(ctxFor({ projectId: PROJECT_ID }, { authorization: 'Bearer abc123' }));
    expect(projectAccess.getProjectRole).toHaveBeenCalledWith(PROJECT_ID, 'Bearer abc123');
  });
});
