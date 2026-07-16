import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { generatePublicSdkKey } from '../support/key-generator';
import type { z } from 'zod';
import type { createAppSchema } from '../support/catalog.schemas';

type CreateApp = z.infer<typeof createAppSchema>;

@Injectable()
export class AppsService {
  constructor(private readonly prisma: PrismaService) {}

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
      orderBy: { createdAt: 'asc' },
      omit: { storeCredentials: true },
    });
  }

  async remove(projectId: string, appId: string) {
    const app = await this.prisma.app.findFirst({ where: { id: appId, projectId } });
    if (!app) throw new ProblemException({ status: 404, title: 'App not found' });
    try {
      await this.prisma.app.delete({ where: { id: appId } });
    } catch (e) {
      if (isForeignKeyViolation(e)) throw new ProblemException({ status: 409, title: 'App is referenced by a package' });
      throw e;
    }
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Prisma P2003 = foreign key constraint violation. */
function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2003';
}
