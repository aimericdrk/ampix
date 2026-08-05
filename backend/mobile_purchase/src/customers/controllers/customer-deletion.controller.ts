import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { CustomerDeletionService } from '../services/customer-deletion.service';

@Controller('api/v1/projects/:projectId/customers')
@UseGuards(ProjectAccessGuard)
export class CustomerDeletionController {
  constructor(private readonly service: CustomerDeletionService) {}

  @Delete(':customerId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('customerId') customerId: string) {
    return this.service.remove(projectId, customerId);
  }
}
