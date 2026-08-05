import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { parseOrThrow } from '../../common/zod';
import { customersListQuerySchema } from '../support/customers.schemas';
import { CustomersQueryService } from '../services/customers-query.service';
import { CustomerDetailService } from '../services/customer-detail.service';

@Controller('api/v1/projects/:projectId/customers')
@UseGuards(ProjectAccessGuard)
export class CustomersController {
  constructor(
    private readonly queryService: CustomersQueryService,
    private readonly detailService: CustomerDetailService,
  ) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string, @Query() query: unknown) {
    return this.queryService.list(projectId, parseOrThrow(customersListQuerySchema, query));
  }

  @Get(':customerId')
  @RequireProjectRole('viewer')
  detail(@Param('projectId') projectId: string, @Param('customerId') customerId: string) {
    return this.detailService.getDetail(projectId, customerId);
  }
}
