import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { parseOrThrow } from '../../common/zod';
import { metricsQuerySchema } from '../support/metrics.schemas';
import { MetricsService } from '../services/metrics.service';

@Controller('api/v1/projects/:projectId/metrics')
@UseGuards(ProjectAccessGuard)
export class MrrController {
  constructor(private readonly service: MetricsService) {}

  @Get('mrr')
  @RequireProjectRole('viewer')
  mrr(@Param('projectId') projectId: string, @Query() query: unknown) {
    return this.service.mrr(projectId, parseOrThrow(metricsQuerySchema, query));
  }
}
