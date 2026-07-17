import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { generatePublicSdkKey } from '../support/key-generator';
import type { createAppSchema } from '../support/catalog.schemas';
import { AppPlatform } from '../../../generated/client';

type CreateApp = z.infer<typeof createAppSchema>;

@Injectable()
export class AppsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the iOS App a webhook's `bundleId` belongs to (design §1.1: "App mapping:
   * `App.findFirst({ projectId?: any, platform: IOS, bundleId })`"). `projectId` is unknown at
   * this point in the Apple ingest flow — resolving it IS the point of this lookup — so this
   * intentionally queries across all projects by `(platform, bundleId)` alone. Returns just the
   * two fields M2b's ingest handler needs; `null` on an unknown bundleId (the notification is then
   * journaled `SKIPPED`, design §1.1).
   */
  findByBundleId(bundleId: string): Promise<{ id: string; projectId: string } | null> {
    return this.prisma.app.findFirst({
      where: { platform: AppPlatform.IOS, bundleId },
      select: { id: true, projectId: true },
    });
  }

  async create(projectId: string, input: CreateApp) {
    try {
      return await this.prisma.app.create({
        data: {
          projectId,
          name: input.name,
          platform: input.platform,
          bundleId: input.bundleId ?? null,
          packageName: input.packageName ?? null,
          publicSdkKey: generatePublicSdkKey(),
        },
        // storeCredentials is an encrypted-at-rest blob — never echo it back, even right after
        // create (it's null at this point anyway, but omit defends against future misuse).
        omit: { storeCredentials: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'App already exists' });
      throw e;
    }
  }

  list(projectId: string) {
    return this.prisma.app.findMany({
      where: { projectId },
      omit: { storeCredentials: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(projectId: string, appId: string) {
    const app = await this.prisma.app.findFirst({ where: { id: appId, projectId } });
    if (!app) throw new ProblemException({ status: 404, title: 'App not found' });
    try {
      await this.prisma.app.delete({ where: { id: appId } });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new ProblemException({ status: 409, title: 'App is referenced by a package and cannot be deleted' });
      }
      throw e;
    }
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Prisma P2003 = foreign key constraint violation (e.g. deleting an App whose Product still has
 * a Package referencing it via an onDelete: Restrict relation). */
function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2003';
}
