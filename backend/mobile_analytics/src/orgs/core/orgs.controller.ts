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
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { Roles } from '../../authz/roles.decorator';
import { RolesGuard } from '../../authz/roles.guard';
import { createOrgSchema, renameOrgSchema } from './orgs.schemas';
import { OrgsService } from './orgs.service';
import type { CreatedOrg, OrgListItem, RenamedOrg } from './orgs.types';

@Controller('api/v1/orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown): Promise<CreatedOrg> {
    const dto = parseOrThrow(createOrgSchema, body);
    return this.orgs.create(req.user!.id, dto.name);
  }

  @Get()
  async list(@Req() req: AuthRequest): Promise<{ orgs: OrgListItem[] }> {
    const orgs = await this.orgs.listForUser(req.user!.id);
    return { orgs };
  }

  @Patch(':orgId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async rename(@Param('orgId') orgId: string, @Body() body: unknown): Promise<RenamedOrg> {
    const dto = parseOrThrow(renameOrgSchema, body);
    return this.orgs.rename(orgId, dto.name);
  }

  /**
   * Owner-only, one step above `rename`'s admin: this destroys every project, member, invitation
   * and event in the org. RolesGuard resolves `:orgId` (404 unknown, 403 non-owner) before this runs.
   */
  @Delete(':orgId')
  @UseGuards(RolesGuard)
  @Roles('owner')
  @HttpCode(204)
  async remove(@Req() req: AuthRequest, @Param('orgId') orgId: string): Promise<void> {
    await this.orgs.remove(orgId, req.user!.id);
  }
}
