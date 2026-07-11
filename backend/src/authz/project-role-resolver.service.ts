import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';

export interface ProjectRouteParams {
  projectId?: string;
  tokenId?: string;
}
export interface ResolvedProjectAccess {
  projectId: string;
  role: ProjectRole;
}

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, analyst: 2, admin: 3, owner: 4 };
export function projectRoleRank(role: ProjectRole): number {
  return PROJECT_ROLE_RANK[role];
}

@Injectable()
export class ProjectRoleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveProjectId(params: ProjectRouteParams): Promise<string> {
    if (params.projectId !== undefined) {
      if (!isUuidShaped(params.projectId)) throw this.notFound();
      const project = await this.prisma.project.findUnique({ where: { id: params.projectId } });
      if (!project) throw this.notFound();
      return project.id;
    }
    if (params.tokenId !== undefined) {
      if (!isUuidShaped(params.tokenId)) throw this.notFound();
      const token = await this.prisma.sdkToken.findUnique({ where: { id: params.tokenId } });
      if (!token) throw this.notFound();
      return token.projectId;
    }
    throw new Error('ProjectRoleResolverService: route has no projectId/tokenId param');
  }

  /**
   * Org owners get derived owner access to every project in their org: an `owner`-rank org
   * `Membership` on the project's org resolves to `'owner'` even with no `ProjectMembership` row
   * (no per-project row is minted). This mirrors `ProjectsService.resolveProjectRole` so the
   * `ProjectRolesGuard`-gated routes (project CRUD/tokens, dashboards, cohorts, reports,
   * templates, screens) honour the same org-owner access as the `assertMembership` seam.
   */
  async resolveProjectRole(userId: string, projectId: string): Promise<ProjectRole> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw this.notFound();
    const orgMembership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (orgMembership?.role === 'owner') return 'owner';
    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!membership) throw this.forbidden();
    return membership.role;
  }

  async resolve(userId: string, params: ProjectRouteParams): Promise<ResolvedProjectAccess> {
    const projectId = await this.resolveProjectId(params);
    const role = await this.resolveProjectRole(userId, projectId);
    return { projectId, role };
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Not found' });
  }
  private forbidden(): ProblemException {
    return new ProblemException({
      status: 403,
      title: 'Forbidden',
      detail: 'You are not a member of this project',
    });
  }
}
