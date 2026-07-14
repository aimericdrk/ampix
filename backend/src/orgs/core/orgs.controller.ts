import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../auth/auth.schemas';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
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
}
