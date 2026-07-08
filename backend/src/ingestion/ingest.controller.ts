import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import {
  IngestResponse,
  ProfileOperation,
  RejectedItem,
  ingestEventsRequestSchema,
  ingestProfilesRequestSchema,
  profileOperationSchema,
} from '@myampix/contracts';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProblemException } from '../common/problem-details';
import { EventNormalizer, formatZodReason } from './event-normalizer';
import { ProfileWriter } from './profile-writer';
import { SdkTokenGuard } from './sdk-token.guard';
import { IngestRateLimitGuard } from './rate-limit.guard';
import type { IngestRequest } from './ingest-auth';

@Controller('ingest')
@UseGuards(SdkTokenGuard, IngestRateLimitGuard)
export class IngestController {
  constructor(
    private readonly normalizer: EventNormalizer,
    private readonly profileWriter: ProfileWriter,
    private readonly clickhouse: ClickHouseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) { }

  @Post('events')
  @HttpCode(202)
  async ingestEvents(@Body() body: unknown, @Req() req: IngestRequest): Promise<IngestResponse> {
    const items = this.parseEnvelope(body, ingestEventsRequestSchema, 'events');
    const { rows, rejected } = this.normalizer.normalizeBatch(req.ingestAuth!.projectId, items);
    await this.clickhouse.insertEvents(rows);
    return { accepted: rows.length, rejected };
  }

  @Post('profiles')
  @HttpCode(202)
  async ingestProfiles(@Body() body: unknown, @Req() req: IngestRequest): Promise<IngestResponse> {
    const items = this.parseEnvelope(body, ingestProfilesRequestSchema, 'operations');
    const operations: ProfileOperation[] = [];
    const rejected: RejectedItem[] = [];
    items.forEach((item, index) => {
      const parsed = profileOperationSchema.safeParse(item);
      if (!parsed.success) {
        rejected.push({ index, reason: formatZodReason(parsed.error) });
        return;
      }
      operations.push(parsed.data);
    });
    await this.profileWriter.apply(req.ingestAuth!.projectId, operations);
    return { accepted: operations.length, rejected };
  }

  private parseEnvelope(
    body: unknown,
    schema: ZodTypeAny,
    field: 'events' | 'operations',
  ): unknown[] {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: `Body must be an object with a non-empty "${field}" array`,
      });
    }
    const items = (parsed.data as Record<string, unknown[]>)[field];
    if (items.length > this.config.ingestMaxBatch) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: `Batch exceeds INGEST_MAX_BATCH=${this.config.ingestMaxBatch} items`,
      });
    }
    return items;
  }
}
