import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../common/zod';
import { ProjectAccessGuard } from '../authz/project-access.guard';
import { RequireProjectRole } from '../authz/require-project-role.decorator';
import { createServerKeySchema } from './server-keys.schemas';
import { ServerKeysService } from './server-keys.service';

/**
 * Dashboard-facing management of a project's server keys — the credentials its own backend uses
 * for server-to-server calls, today just subscriber erasure. Admin-only for every route,
 * including the list: a server key is a live secret, not configuration, so a viewer who can read
 * the project's data still can't read a credential that deletes it.
 */
@Controller('api/v1/projects/:projectId/server-keys')
@UseGuards(ProjectAccessGuard)
export class ServerKeysController {
  constructor(private readonly service: ServerKeysService) {}

  @Get()
  @RequireProjectRole('admin')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    const dto = parseOrThrow(createServerKeySchema, body);
    return this.service.create(projectId, dto.label, dto.can_erase);
  }

  @Delete(':keyId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  revoke(@Param('projectId') projectId: string, @Param('keyId') keyId: string) {
    return this.service.revoke(projectId, keyId);
  }
}
