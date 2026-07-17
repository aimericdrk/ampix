import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';

/** The App resolved from a valid publicSdkKey — attached to the request for downstream handlers. */
export interface SdkApp {
  id: string;
  projectId: string;
}

export interface RequestWithSdkApp extends Request {
  sdkApp: SdkApp;
}

function unauthorized(): ProblemException {
  return new ProblemException({
    status: 401,
    title: 'Unauthorized',
    detail: 'Invalid or missing SDK key',
  });
}

function extractBearerKey(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match ? match[1] : null;
}

/**
 * Authenticates a client SDK by its App's `publicSdkKey`, read from `Authorization: Bearer <key>`.
 * This is the PUBLIC surface flutter_purchases calls directly — no JWT, no ProjectAccessGuard,
 * no analytics round-trip. A missing/unknown/malformed key is rejected with 401; on success the
 * resolved App (id + projectId) is attached to the request as `req.sdkApp`.
 */
@Injectable()
export class PublicApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSdkApp>();
    const key = extractBearerKey(req.headers.authorization);
    if (!key) throw unauthorized();

    const app = await this.prisma.app.findUnique({
      where: { publicSdkKey: key },
      select: { id: true, projectId: true },
    });
    if (!app) throw unauthorized();

    req.sdkApp = { id: app.id, projectId: app.projectId };
    return true;
  }
}
