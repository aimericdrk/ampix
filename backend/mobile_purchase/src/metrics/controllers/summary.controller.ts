import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { parseOrThrow } from '../../common/zod';
import { metricsQuerySchema } from '../support/metrics.schemas';
import { SummaryService } from '../services/summary.service';

@Controller('api/v1/projects/:projectId/metrics')
@UseGuards(ProjectAccessGuard)
export class SummaryController {
  constructor(private readonly service: SummaryService) {}

  @Get('summary')
  @RequireProjectRole('viewer')
  summary(@Param('projectId') projectId: string, @Query() query: unknown) {
    return this.service.summary(projectId, parseOrThrow(metricsQuerySchema, query));
  }
}
