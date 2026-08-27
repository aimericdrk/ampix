import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { generateServerKey } from '../catalog/support/key-generator';
import type { ServerKeyListItem } from './server-keys.schemas';

const DEFAULT_LABEL = 'default';

/** Matches the `uuid(7)` ids Prisma generates — an id-shaped check before any lookup. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Project-scoped CRUD for server keys (the credentials a customer's own backend uses). Every
 * method re-scopes by `projectId` itself rather than trusting the id in the path: an admin of one
 * project must not be able to reach another project's key just by knowing its id.
 */
@Injectable()
export class ServerKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string): Promise<ServerKeyListItem[]> {
    const keys = await this.prisma.serverKey.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      key: k.key,
      label: k.label,
      can_erase: k.canErase,
      created_at: k.createdAt.toISOString(),
    }));
  }

  async create(projectId: string, label?: string, canErase = false): Promise<ServerKeyListItem> {
    const created = await this.prisma.serverKey.create({
      data: { projectId, key: generateServerKey(), label: label ?? DEFAULT_LABEL, canErase },
    });
    return {
      id: created.id,
      key: created.key,
      label: created.label,
      can_erase: created.canErase,
      created_at: created.createdAt.toISOString(),
    };
  }

  /**
   * Revocation is a `revokedAt` stamp, not a delete: the row stays as the record that this
   * credential once existed. 404 when the id isn't uuid-shaped, belongs to another project, or is
   * already revoked — all three are "no such live key here", and saying which would leak whether
   * an id exists elsewhere.
   */
  async revoke(projectId: string, keyId: string): Promise<void> {
    if (!UUID_REGEX.test(keyId)) throw this.notFound();
    const key = await this.prisma.serverKey.findUnique({ where: { id: keyId } });
    if (!key || key.projectId !== projectId || key.revokedAt !== null) throw this.notFound();
    await this.prisma.serverKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  }

  private notFound(): ProblemException {
    return new ProblemException({
      status: 404,
      title: 'Not Found',
      detail: 'Server key not found',
    });
  }
}
