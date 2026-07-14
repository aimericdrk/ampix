import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { RcIntegrationRef } from './rc-webhook.processor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RcWebhookRequest extends Request {
  rcIntegration?: RcIntegrationRef;
}

/**
 * Authenticates RevenueCat's webhook calls: the Authorization header the user pasted
 * into the RC dashboard must equal the project's generated webhookSecret (spec §4.2).
 * Constant-time compare; RC may or may not send a "Bearer " prefix — accept both.
 */
@Injectable()
export class RcWebhookGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RcWebhookRequest>();
    const projectId = req.params.projectId as string;
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) throw new NotFoundException();

    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    if (integration === null) throw new NotFoundException();

    const raw = req.headers.authorization ?? '';
    const provided = raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
    const a = Buffer.from(provided);
    const b = Buffer.from(integration.webhookSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();

    req.rcIntegration = {
      id: integration.id,
      projectId: integration.projectId,
      sandboxMode: integration.sandboxMode,
    };
    return true;
  }
}
