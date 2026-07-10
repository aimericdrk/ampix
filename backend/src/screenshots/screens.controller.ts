import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ScreenListItem, ScreenshotsService } from './screenshots.service';

/**
 * §18 — dashboard-facing screenshot reads under `/api/v1/projects/:projectId/screens`. JWT-guarded,
 * with project membership (viewer+) enforced inside {@link ScreenshotsService} — the same surface +
 * tenancy pattern as the §14/§19 read controllers.
 */
@Controller('api/v1/projects/:projectId/screens')
@UseGuards(JwtAuthGuard)
export class ScreensController {
  constructor(private readonly screenshots: ScreenshotsService) {}

  @Get()
  async list(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ screens: ScreenListItem[] }> {
    return this.screenshots.listScreens(req.user!.id, projectId);
  }

  @Get(':screenName/image')
  // Private (per-user, membership-gated) and short-lived: safe to cache in the browser briefly,
  // never in a shared proxy.
  @Header('Cache-Control', 'private, max-age=300')
  async image(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('screenName') screenName: string,
    @Query('app_version') appVersion?: string,
    @Query('hash') hash?: string,
  ): Promise<StreamableFile> {
    const { stream, contentType } = await this.screenshots.getImage(
      req.user!.id,
      projectId,
      screenName,
      { appVersion, hash },
    );
    return new StreamableFile(stream, { type: contentType });
  }

  /**
   * §18 retake/delete — removes a screen's reference image(s): all versions, or one when
   * `app_version` is given. Analyst+ (destructive), via ProjectRolesGuard resolving the project
   * role from `:projectId`. `204` even if nothing matched.
   */
  @Delete(':screenName')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  @HttpCode(204)
  async remove(
    @Param('projectId') projectId: string,
    @Param('screenName') screenName: string,
    @Query('app_version') appVersion?: string,
  ): Promise<void> {
    await this.screenshots.deleteScreen(projectId, screenName, appVersion);
  }
}
