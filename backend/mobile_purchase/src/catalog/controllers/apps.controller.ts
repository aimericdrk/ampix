import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { createAppSchema } from '../support/catalog.schemas';
import { AppsService } from '../services/apps.service';
import { StoreCredentialsService } from '../store-credentials/store-credentials.service';

@Controller('api/v1/projects/:projectId/catalog/apps')
@UseGuards(ProjectAccessGuard)
export class AppsController {
  constructor(
    private readonly service: AppsService,
    private readonly storeCredentials: StoreCredentialsService,
  ) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createAppSchema, body));
  }

  @Delete(':appId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('appId') appId: string) {
    return this.service.remove(projectId, appId);
  }

  // --- store-credentials sub-resource (design §1.4). Grouped on AppsController — not a separate
  // controller — because every route is app-scoped under :appId, exactly like ProductsController
  // owns its products/:productId/entitlements sub-resource. Admin writes, viewer status read;
  // the encrypted blob is never returned by any of them. ---

  @Put(':appId/store-credentials')
  @RequireProjectRole('admin')
  setStoreCredentials(
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
    @Body() body: unknown,
  ) {
    // PUT defaults to HTTP 200 in Nest; the StoreCredentialStatus is returned, never the secret.
    return this.storeCredentials.set(projectId, appId, body);
  }

  @Get(':appId/store-credentials/status')
  @RequireProjectRole('viewer')
  storeCredentialsStatus(
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
  ) {
    return this.storeCredentials.status(projectId, appId);
  }

  @Delete(':appId/store-credentials')
  @HttpCode(204)
  @RequireProjectRole('admin')
  disconnectStoreCredentials(
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
  ) {
    return this.storeCredentials.disconnect(projectId, appId);
  }
}
