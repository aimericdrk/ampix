import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import {
  createDashboardSchema,
  createTileSchema,
  layoutSchema,
  updateDashboardSchema,
  updateTileSchema,
} from './dashboard.schema';
import type {
  DashboardData,
  DashboardDetail,
  DashboardListItem,
  TileView,
} from './dashboard.types';
import { DashboardsService } from './dashboards.service';

/**
 * Custom dashboards management API (contracts §16). Under `/api/v1/projects/:projectId/dashboards`.
 * Reads viewer+, writes analyst+ (ProjectRolesGuard resolves the project role from `:projectId`).
 */
@Controller('api/v1/projects/:projectId/dashboards')
@UseGuards(JwtAuthGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async list(@Param('projectId') projectId: string): Promise<{ dashboards: DashboardListItem[] }> {
    const dashboards = await this.dashboards.list(projectId);
    return { dashboards };
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async create(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<DashboardListItem> {
    const dto = parseOrThrow(createDashboardSchema, body);
    return this.dashboards.create(projectId, req.user!.id, dto);
  }

  @Get(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<DashboardDetail> {
    return this.dashboards.get(projectId, id);
  }

  @Get(':id/data')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async data(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<DashboardData> {
    return this.dashboards.getData(req.user!.id, projectId, id);
  }

  @Patch(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DashboardListItem> {
    const dto = parseOrThrow(updateDashboardSchema, body);
    return this.dashboards.update(projectId, id, dto);
  }

  @Delete(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  @HttpCode(204)
  async remove(@Param('projectId') projectId: string, @Param('id') id: string): Promise<void> {
    await this.dashboards.remove(projectId, id);
  }

  @Patch(':id/layout')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async saveLayout(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DashboardDetail> {
    const dto = parseOrThrow(layoutSchema, body);
    return this.dashboards.saveLayout(projectId, id, dto);
  }

  @Post(':id/tiles')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async createTile(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TileView> {
    const dto = parseOrThrow(createTileSchema, body);
    return this.dashboards.createTile(projectId, id, dto);
  }

  @Patch(':id/tiles/:tileId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async updateTile(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('tileId') tileId: string,
    @Body() body: unknown,
  ): Promise<TileView> {
    const dto = parseOrThrow(updateTileSchema, body);
    return this.dashboards.updateTile(projectId, id, tileId, dto);
  }

  @Delete(':id/tiles/:tileId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  @HttpCode(204)
  async removeTile(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('tileId') tileId: string,
  ): Promise<void> {
    await this.dashboards.removeTile(projectId, id, tileId);
  }
}
