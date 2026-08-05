import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { parseOrThrow } from '../../common/zod';
import { metricsQuerySchema } from '../support/metrics.schemas';
import { MrrMovementService } from '../services/mrr-movement.service';

@Controller('api/v1/projects/:projectId/metrics')
@UseGuards(ProjectAccessGuard)
export class MrrMovementController {
  constructor(private readonly service: MrrMovementService) {}

  @Get('mrr-movement')
  @RequireProjectRole('viewer')
  mrrMovement(@Param('projectId') projectId: string, @Query() query: unknown) {
    return this.service.mrrMovement(projectId, parseOrThrow(metricsQuerySchema, query));
  }
}
