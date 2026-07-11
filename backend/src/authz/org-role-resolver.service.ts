import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';

/** Route params RolesGuard may find on a §13 tenancy-scoped route. */
export interface RouteParams {
  orgId?: string;
  projectId?: string;
  tokenId?: string;
}

export interface ResolvedAccess {
  orgId: string;
  role: Role;
}

const ROLE_RANK: Record<Role, number> = { viewer: 1, analyst: 2, admin: 3, owner: 4 };

/** owner > admin > analyst > viewer, as a comparable number ("a route needs role >= the required level"). */
export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

/**
 * Shared org/role resolution for RolesGuard (contracts §13): derives the org a route operates on
 * straight from Postgres — never from anything client-supplied beyond the path params NestJS
 * itself parsed — then looks up the caller's Membership role in THAT org. Reused across every
 * tenancy-scoped controller so this derivation lives in exactly one place.
 *
 * Resolution order: `:orgId` directly; else `:projectId` -> that project's org; else `:tokenId`
 * -> that SdkToken's project -> its org. An unknown org/project/token -> 404. No membership row
 * for the resolved org -> 403.
 */
@Injectable()
export class OrgRoleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOrgId(params: RouteParams): Promise<string> {
    if (params.orgId !== undefined) {
      if (!isUuidShaped(params.orgId)) throw this.notFound();
      const org = await this.prisma.organization.findUnique({ where: { id: params.orgId } });
      if (!org) throw this.notFound();
      return org.id;
    }
    if (params.projectId !== undefined) {
      if (!isUuidShaped(params.projectId)) throw this.notFound();
      const project = await this.prisma.project.findUnique({ where: { id: params.projectId } });
      if (!project) throw this.notFound();
      return project.orgId;
    }
    if (params.tokenId !== undefined) {
      if (!isUuidShaped(params.tokenId)) throw this.notFound();
      const token = await this.prisma.sdkToken.findUnique({ where: { id: params.tokenId } });
      if (!token) throw this.notFound();
      const project = await this.prisma.project.findUnique({ where: { id: token.projectId } });
      if (!project) throw this.notFound();
      return project.orgId;
    }
    // Programmer error, not a runtime input error: any route guarded by RolesGuard must expose
    // one of orgId/projectId/tokenId as a path param.
    throw new Error('OrgRoleResolverService: route has no orgId/projectId/tokenId param');
  }

  async resolveMembership(userId: string, orgId: string): Promise<Role> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!membership) throw this.forbidden();
    return membership.role;
  }

  /** Resolves the target org, then the caller's role in it. */
  async resolve(userId: string, params: RouteParams): Promise<ResolvedAccess> {
    const orgId = await this.resolveOrgId(params);
    const role = await this.resolveMembership(userId, orgId);
    return { orgId, role };
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Not found' });
  }

  private forbidden(): ProblemException {
    return new ProblemException({
      status: 403,
      title: 'Forbidden',
      detail: 'You are not a member of this organization',
    });
  }
}
