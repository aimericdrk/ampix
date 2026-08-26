import { Controller, Delete, Param, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { SdkTokenGuard } from '../ingestion/sdk-token.guard';
import { IngestRateLimitGuard } from '../ingestion/rate-limit.guard';
import type { IngestRequest } from '../ingestion/ingest-auth';
import { ProblemException } from '../common/problem-details';
import { ErasureKeyGuard } from './erasure-key.guard';
import { ErasureService } from './erasure.service';

/** Same bounds as the ingest id fields (contracts §4 idSchema: 1–255 chars). */
const distinctIdParamSchema = z.string().min(1).max(255);

/**
 * Server-to-server end-user erasure, called by an app backend when a user deletes their account.
 * Mounted under /ingest so it shares the SDK-token project scoping and per-token rate limiting of
 * the other ingest endpoints; ErasureKeyGuard adds the shared-secret second factor that actually
 * authorizes the destructive delete (the SDK token alone never does — it ships in the app).
 */
@Controller('ingest')
@UseGuards(SdkTokenGuard, IngestRateLimitGuard, ErasureKeyGuard)
export class ErasureController {
  constructor(private readonly erasure: ErasureService) {}

  @Delete('users/:distinctId')
  async eraseUser(@Param('distinctId') distinctId: string, @Req() req: IngestRequest) {
    const parsed = distinctIdParamSchema.safeParse(distinctId);
    if (!parsed.success) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: 'distinctId must be 1-255 characters',
      });
    }
    const cleared = await this.erasure.erase(req.ingestAuth!.projectId, parsed.data);
    return { distinct_id: parsed.data, deleted: true, cleared };
  }
}
