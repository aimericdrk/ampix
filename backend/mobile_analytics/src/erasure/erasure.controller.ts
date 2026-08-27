import { Controller, Delete, Param, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { SdkTokenGuard } from '../ingestion/sdk-token.guard';
import { IngestRateLimitGuard } from '../ingestion/rate-limit.guard';
import type { IngestRequest } from '../ingestion/ingest-auth';
import { ProblemException } from '../common/problem-details';
import { ErasureCapabilityGuard } from './erasure-capability.guard';
import { ErasureService } from './erasure.service';

/** Same bounds as the ingest id fields (contracts §4 idSchema: 1–255 chars). */
const distinctIdParamSchema = z.string().min(1).max(255);

/**
 * Server-to-server end-user erasure, called by an app backend when a user deletes their account.
 * Mounted under /ingest so it shares the SDK-token project scoping and per-token rate limiting of
 * the other ingest endpoints; ErasureCapabilityGuard then requires that token to be a *server*
 * token carrying the erasure capability. Both facts live on the token row, which is why this
 * needs no shared secret: the credential is already per-project and issued from the dashboard.
 */
@Controller('ingest')
@UseGuards(SdkTokenGuard, IngestRateLimitGuard, ErasureCapabilityGuard)
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
